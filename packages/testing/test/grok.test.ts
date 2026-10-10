import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import type { Result } from "@rivus/agent-kit-catalog";
import type { FileStat } from "@rivus/agent-kit-platform";
import {
  builtinSessionAdapters,
  decodeUsage,
  foldTranscript,
  isSessionHead,
  isUsageRecord,
  listSessions,
  loadTranscript,
  type DecodeUsageOptions,
  type SessionHead,
  summarizeSession,
  translateGrokRecords,
  type Transcript,
  type UsageCursor,
  type UsageRecord
} from "@rivus/agent-kit-sessions";
import { describe, expect, it } from "vite-plus/test";

import { createMemoryPlatform } from "../src/memory-platform.js";
import { readTree } from "./support.js";

const tree = await readTree(fileURLToPath(new URL("fixtures/grok", import.meta.url)), "/u/me/.grok/sessions");
const files = {
  ...tree,
  "/u/me/.grok/sessions/bad-summary/updates.jsonl":
    '{"timestamp":"2026-01-01T00:00:00.000Z","params":{"update":{"sessionUpdate":"widget"}}}\n',
  "/u/me/.grok/sessions/bad-summary/summary.json": '{"chat_format_version":2}\n'
};
const platform = createMemoryPlatform({ files, home: "/u/me" });
const session = (name: string) => `/u/me/.grok/sessions/${name}/updates.jsonl`;

function value<T>(result: Result<T, unknown>): T {
  if (!result.ok) {
    throw new Error(`unexpected failure: ${JSON.stringify(result.error)}`);
  }
  return result.value;
}

const load = async (name: string): Promise<Transcript> =>
  value(await loadTranscript(platform, { agent: "grok", path: session(name) }));

function grokRecord(update: Record<string, unknown>, line: number) {
  return {
    value: { timestamp: "2026-01-01T00:00:00.000Z", params: { update } },
    file: "updates.jsonl",
    line,
    offset: 0,
    length: 1
  };
}

const turnUsage = {
  inputTokens: 15,
  outputTokens: 4,
  totalTokens: 19,
  cacheReadTokens: 3,
  cacheWriteTokens: 1,
  reasoningTokens: 2
};

describe("grok translation", () => {
  it("maps one request per turn before its output and keeps turn usage as a turn summary", async () => {
    const transcript = await load("conformance/plain");
    expect(transcript.session.systemPrompt).toContain("test agent");
    expect(transcript.session.tools).toEqual([
      { type: "function", function: { name: "shell", description: "Run a command" } }
    ]);
    expect(transcript.events.map((event) => event.kind)).toEqual([
      "user",
      "user",
      "request",
      "reasoning",
      "tool_call",
      "tool_result",
      "hook",
      "assistant",
      "system"
    ]);
    expect(transcript.events.filter((event) => event.kind === "user").map((event) => event.payload)).toEqual([
      { text: "Run the tests" },
      { continued: true, text: "now" }
    ]);
    const request = transcript.events.find((event) => event.kind === "request");
    expect(request?.payload).toEqual({
      granularity: "turn",
      model: "grok-test",
      modelCalls: 2,
      finishReason: "end_turn",
      usage: turnUsage,
      usageByModel: { "grok-test": { usage: turnUsage, modelCalls: 2 } }
    });
    expect(request?.original).toMatchObject({
      params: { update: { usage: { costUsdTicks: 7, modelUsage: { "grok-test": { costUsdTicks: 7 } } } } }
    });
    expect(request?.requestId).toBe("0");
    expect(
      transcript.events.every((event) => event.kind === "request" || event.requestId === "0" || event.kind === "system")
    ).toBe(true);
    expect(transcript.events.at(-1)?.payload).toEqual({ type: "turn_duration", durationMs: 25 });
    expect(transcript.events.find((event) => event.kind === "tool_result")?.payload.isError).toBe(true);
    expect(transcript.events.find((event) => event.kind === "hook")?.payload).toEqual({
      type: "hook_execution",
      event_name: "PostToolUse",
      tool_name: "shell",
      runs: [{ name: "lint", status: "success", elapsedMs: 5 }]
    });
    expect(transcript.events.find((event) => event.kind === "reasoning")?.payload).toEqual({
      text: "Look at the script."
    });
    expect(transcript.skipped.map((skip) => skip.reason)).toEqual(["tool-progress"]);
    expect(transcript.capabilities).toEqual([
      "requests",
      "usage",
      "durations",
      "reasoning",
      "compaction",
      "compactionTokens",
      "subagents",
      "hooks",
      "systemPrompt",
      "toolSchemas"
    ]);
    expect(transcript).toMatchObject({
      agent: "grok",
      session: { id: "g-plain", title: "Plain session", cwd: "/u/me/work" }
    });
    const summary = foldTranscript(transcript);
    expect(summary.turns).toBe(1);
    expect(summary.durationMs).toBe(25);
    expect(summary.contextShape).toEqual([15]);
    for (let index = 1; index < transcript.events.length; index++) {
      expect(transcript.events[index]!.ts).toBeGreaterThanOrEqual(transcript.events[index - 1]!.ts);
    }
  });

  it("lists systemPrompt and toolSchemas only when the session directory has the side files", async () => {
    for (const name of ["compaction", "subagent", "unknown-type"]) {
      const transcript = await load(`conformance/${name}`);
      expect(transcript.session.systemPrompt).toBeUndefined();
      expect(transcript.session.tools).toBeUndefined();
      expect(transcript.capabilities).not.toContain("systemPrompt");
      expect(transcript.capabilities).not.toContain("toolSchemas");
      expect(transcript.capabilities).toContain("requests");
    }
  });

  it("shadows events before an automatic compaction", async () => {
    const transcript = await load("conformance/compaction");
    const compaction = transcript.events.find((event) => event.kind === "compaction");
    expect(compaction?.payload).toEqual({ trigger: "auto", preTokens: 500, postTokens: 80 });
    const users = transcript.events.filter((event) => event.kind === "user");
    expect(users[0]?.shadowedBy).toBe(compaction?.id);
    expect(users[1]?.shadowedBy).toBeUndefined();
    expect(users[1]?.payload.injected).toBe(true);
    expect(transcript.skipped.map((skip) => skip.reason)).toEqual(["compact-started"]);
  });

  it("records a subagent lane from the spawn event and from a meta file, and maps status updates", async () => {
    const transcript = await load("conformance/subagent");
    const spawned = transcript.events.find((event) => event.payload.type === "subagent_spawned");
    expect(transcript.agents).toContainEqual({
      id: "child-1",
      parentId: "main",
      title: "Look around",
      spawnEventId: spawned?.id
    });
    expect(transcript.agents).toContainEqual({ id: "meta-only", parentId: "main", title: "From meta" });
    expect(transcript.agents.find((lane) => lane.id === "main")?.spawnEventId).toBeUndefined();
    expect(transcript.events.filter((event) => event.kind === "system").map((event) => event.payload.type)).toEqual([
      "subagent_spawned",
      "subagent_finished",
      "goal_updated",
      "memory_dream_started"
    ]);
    expect(transcript.events.every((event) => event.kind !== "unknown")).toBe(true);
    expect(transcript.events[0]?.payload.injected).toBe(true);
    expect(foldTranscript(transcript).turns).toBe(1);
  });

  it("takes the discover title from summary.json and skips an injected chunk", async () => {
    const heads: SessionHead[] = [];
    for await (const item of listSessions(platform, { agents: ["grok"] })) {
      if (isSessionHead(item) && item.ref.path.endsWith("/subagent/updates.jsonl")) {
        heads.push(item);
      }
    }
    expect(heads).toMatchObject([
      {
        ref: { agent: "grok", sessionId: "g-sub" },
        title: "Subagent session",
        cwd: "/u/me/work",
        firstPrompt: "Delegate"
      }
    ]);
    expect(heads[0]?.ref.path.startsWith("/u/me/.grok/sessions/")).toBe(true);
  });

  it("keeps an unknown record type and returns an unknown generation as a tagged failure", async () => {
    const transcript = await load("conformance/unknown-type");
    expect(transcript.events[0]?.payload.type).toBe("widget");
    const path = session("unknown-generation");
    expect(await loadTranscript(platform, { agent: "grok", path })).toEqual({
      ok: false,
      error: { _tag: "UnknownFormatGeneration", agent: "grok", file: path, line: 1 }
    });
    const summary = "/u/me/.grok/sessions/bad-summary/summary.json";
    expect(await loadTranscript(platform, { agent: "grok", path: session("bad-summary") })).toEqual({
      ok: false,
      error: { _tag: "UnknownFormatGeneration", agent: "grok", file: summary, line: 1 }
    });
  });

  it("skips a summary and tool definitions that are not JSON", async () => {
    const dir = "/u/me/.grok/sessions/bad-json";
    const broken = createMemoryPlatform({
      files: {
        [`${dir}/updates.jsonl`]:
          '{"timestamp":"2026-01-01T00:00:00.000Z","params":{"update":{"sessionUpdate":"widget"}}}\n',
        [`${dir}/summary.json`]: "{",
        [`${dir}/tool_definitions.json`]: "{"
      },
      home: "/u/me"
    });
    const transcript = value(await loadTranscript(broken, { agent: "grok", path: `${dir}/updates.jsonl` }));
    expect(transcript.skipped.map((skip) => skip.reason)).toEqual(["invalid-json", "invalid-json"]);
    expect(transcript.skipped.map((skip) => skip.source.file)).toEqual([
      `${dir}/summary.json`,
      `${dir}/tool_definitions.json`
    ]);
    expect(transcript.session.tools).toBeUndefined();
    expect(transcript.events[0]?.payload.type).toBe("widget");
  });

  it("returns an unknown generation from the pure translation", () => {
    const value = {
      timestamp: "2026-01-01T00:00:00.000Z",
      params: { update: { sessionUpdate: "user_message_chunk", schema_version: 4 } }
    };
    expect(translateGrokRecords([{ value, file: "updates.jsonl", line: 1, offset: 0, length: 1 }])).toEqual({
      ok: false,
      error: { _tag: "UnknownFormatGeneration", agent: "grok", file: "updates.jsonl", line: 1 }
    });
  });

  it("detects a session directory as well as its updates file", async () => {
    const adapter = builtinSessionAdapters.grok;
    const dir = "/u/me/.grok/sessions/conformance/plain";
    expect(await adapter.detect(platform, { agent: "grok", path: dir })).toBe(true);
    expect(await adapter.detect(platform, { agent: "grok", path: `${dir}/updates.jsonl` })).toBe(true);
    expect(await adapter.detect(platform, { agent: "grok", path: "/u/me/.grok/sessions/missing" })).toBe(false);
  });

  it("keeps a tool call's name when a later update shows a display title, and merges the update's args", async () => {
    const transcript = await load("conformance/tool-title");
    const calls = transcript.events.filter((event) => event.kind === "tool_call");
    expect(calls).toHaveLength(1);
    expect(calls[0]?.payload).toEqual({
      callId: "call-1",
      name: "read_file",
      title: "Read `/u/me/x.md`",
      args: {
        path: "/u/me/x.md",
        background: false,
        variant: "content",
        "-i": false,
        type: "text",
        multiline: false
      }
    });
    expect(transcript.events.filter((event) => event.kind === "tool_result").map((event) => event.payload)).toEqual([
      { callId: "call-1", isError: false, output: "file body" }
    ]);
  });

  it("keeps tool arguments and output when a later update carries only status", () => {
    const parsed = value(
      translateGrokRecords([
        grokRecord({ sessionUpdate: "tool_call", toolCallId: "call-1", title: "shell", status: "pending" }, 1),
        grokRecord(
          {
            sessionUpdate: "tool_call_update",
            toolCallId: "call-1",
            status: "in_progress",
            rawInput: { command: "npm test" },
            content: [{ type: "content", content: { type: "text", text: "1 failed" } }]
          },
          2
        ),
        grokRecord({ sessionUpdate: "tool_call_update", toolCallId: "call-1", status: "completed" }, 3)
      ])
    );
    const calls = parsed.events.filter((event) => event.kind === "tool_call");
    const results = parsed.events.filter((event) => event.kind === "tool_result");
    expect(calls).toHaveLength(1);
    expect(calls[0]?.payload.args).toEqual({ command: "npm test" });
    expect(results).toHaveLength(1);
    expect(results[0]?.payload.output).toBe("1 failed");
    expect(results[0]?.payload.isError).toBe(false);
    expect(parsed.skipped.map((skip) => skip.reason)).toEqual(["tool-progress"]);
  });

  it("leaves prior context in place when compaction starts and never completes", () => {
    const parsed = value(
      translateGrokRecords([
        grokRecord(
          {
            sessionUpdate: "user_message_chunk",
            content: { type: "text", text: "Keep me" },
            _meta: { promptIndex: 0 }
          },
          1
        ),
        grokRecord({ sessionUpdate: "auto_compact_started", tokens_used: 500 }, 2)
      ])
    );
    expect(parsed.events.find((event) => event.kind === "user")?.shadowedBy).toBeUndefined();
    expect(parsed.events.some((event) => event.kind === "compaction")).toBe(false);
    expect(parsed.skipped.map((skip) => skip.reason)).toEqual(["compact-started"]);
  });

  it("takes the request model from this turn's usage when the turn names no model id", () => {
    const parsed = value(
      translateGrokRecords([
        grokRecord(
          {
            sessionUpdate: "user_message_chunk",
            content: { type: "text", text: "First" },
            _meta: { modelId: "grok-old", promptIndex: 0 }
          },
          1
        ),
        grokRecord(
          {
            sessionUpdate: "turn_completed",
            usage: { inputTokens: 1, outputTokens: 1, modelUsage: { "grok-old": { inputTokens: 1, outputTokens: 1 } } }
          },
          2
        ),
        grokRecord(
          {
            sessionUpdate: "user_message_chunk",
            content: { type: "text", text: "Second" },
            _meta: { promptIndex: 1 }
          },
          3
        ),
        grokRecord(
          {
            sessionUpdate: "turn_completed",
            usage: {
              inputTokens: 20,
              outputTokens: 2,
              modelUsage: { "grok-new": { inputTokens: 20, outputTokens: 2 } }
            }
          },
          4
        )
      ])
    );
    const requests = parsed.events.filter((event) => event.kind === "request");
    expect(requests[0]?.payload.model).toBe("grok-old");
    expect(requests[1]?.payload.model).toBe("grok-new");
    expect(requests[1]?.payload.usage).toEqual({ inputTokens: 20, outputTokens: 2, totalTokens: 22 });
    expect(requests[1]?.payload.usageByModel).toEqual({
      "grok-new": { usage: { inputTokens: 20, outputTokens: 2, totalTokens: 22 } }
    });
  });

  it("rejects listing when cancellation happens while the summary is read", async () => {
    const reason = new Error("stop");
    const controller = new AbortController();
    const dir = "/u/me/.grok/sessions/cancel";
    const base = createMemoryPlatform({
      files: {
        [`${dir}/updates.jsonl`]:
          '{"timestamp":"2026-01-01T00:00:00.000Z","params":{"update":{"sessionUpdate":"user_message_chunk","content":{"type":"text","text":"Hi"}}}}\n',
        [`${dir}/summary.json`]: "{"
      },
      home: "/u/me"
    });
    const platform = {
      ...base,
      fs: {
        ...base.fs,
        async stat(path: string, options?: { readonly followSymlinks?: boolean }): Promise<FileStat | undefined> {
          const info = await base.fs.stat(path, options);
          if (path.endsWith("/summary.json") && info?.kind === "file") {
            controller.abort(reason);
            // Past the listing budget, so decoration takes the soft return with the signal already aborted.
            return { kind: "file", size: 64 * 1024 + 1, mtimeMs: info.mtimeMs };
          }
          return info;
        }
      }
    };
    const seen: unknown[] = [];
    await expect(
      (async () => {
        for await (const item of listSessions(platform, { agents: ["grok"], signal: controller.signal })) {
          seen.push(item);
        }
      })()
    ).rejects.toBe(reason);
    expect(seen).toEqual([]);
  });

  it("keeps the full hook output in the normalized payload", () => {
    const output = `${"x".repeat(305)}DIAGNOSTIC`;
    const parsed = value(
      translateGrokRecords([
        grokRecord(
          {
            sessionUpdate: "hook_execution",
            event_name: "PostToolUse",
            runs: [{ name: "lint", output, status: { status: "success" } }]
          },
          1
        )
      ])
    );
    const runs = parsed.events.find((event) => event.kind === "hook")?.payload.runs;
    expect(output).toHaveLength(315);
    expect(runs).toEqual([{ name: "lint", status: "success", output }]);
  });

  it("merges an empty-object rawInput into the previous args, replaces outputs with empty values, and keeps them when the field is null", () => {
    const call = (id: string, line: number) =>
      grokRecord(
        { sessionUpdate: "tool_call", toolCallId: id, title: "shell", rawInput: { command: "npm test" } },
        line
      );
    const done = (id: string, line: number, extra: Record<string, unknown>) =>
      grokRecord({ sessionUpdate: "tool_call_update", toolCallId: id, status: "completed", ...extra }, line);
    const parsed = value(
      translateGrokRecords([
        call("empty-string", 1),
        done("empty-string", 2, { rawOutput: "temporary" }),
        done("empty-string", 3, { rawInput: {}, rawOutput: "" }),
        call("empty-content", 4),
        done("empty-content", 5, { content: [{ type: "content", content: { type: "text", text: "temporary" } }] }),
        done("empty-content", 6, { content: "" }),
        call("empty-array", 7),
        done("empty-array", 8, { rawOutput: "temporary" }),
        done("empty-array", 9, { rawOutput: [] }),
        call("empty-object", 10),
        done("empty-object", 11, { rawOutput: "temporary" }),
        done("empty-object", 12, { rawOutput: {} }),
        call("keep-null", 13),
        done("keep-null", 14, { rawOutput: "temporary" }),
        done("keep-null", 15, { rawInput: null, rawOutput: null, content: null })
      ])
    );
    const argsOf = (id: string) =>
      parsed.events.find((event) => event.kind === "tool_call" && event.payload.callId === id)?.payload.args;
    const outputOf = (id: string) =>
      parsed.events.find((event) => event.kind === "tool_result" && event.payload.callId === id)?.payload.output;
    expect(argsOf("empty-string")).toEqual({ command: "npm test" });
    expect(outputOf("empty-string")).toBe("");
    expect(outputOf("empty-content")).toBe("");
    expect(outputOf("empty-array")).toEqual([]);
    expect(outputOf("empty-object")).toEqual({});
    expect(argsOf("keep-null")).toEqual({ command: "npm test" });
    expect(outputOf("keep-null")).toBe("temporary");
  });

  it("marks a terminal tool update that has no call as an orphan result", () => {
    const parsed = value(
      translateGrokRecords([
        grokRecord({ sessionUpdate: "tool_call_update", toolCallId: "c1", status: "completed", rawOutput: "done" }, 1)
      ])
    );
    expect(parsed.events.map((event) => event.kind)).toEqual(["tool_result"]);
    expect(parsed.events[0]?.payload).toEqual({ callId: "c1", isError: false, output: "done", orphan: true });
  });

  it("returns ReadFailed when summary.json cannot be stated and no agent is named", async () => {
    const dir = "/u/me/.grok/sessions/locked";
    const updates = `${dir}/updates.jsonl`;
    const base = createMemoryPlatform({
      files: {
        [updates]: '{"timestamp":"2026-01-01T00:00:00.000Z","params":{"update":{"sessionUpdate":"widget"}}}\n',
        [`${dir}/summary.json`]: "{}"
      },
      home: "/u/me"
    });
    const denied = Object.assign(new Error("EACCES: permission denied"), { code: "EACCES" });
    const platform = {
      ...base,
      fs: {
        ...base.fs,
        async stat(path: string, options?: { readonly followSymlinks?: boolean }): Promise<FileStat | undefined> {
          if (path.endsWith("/summary.json")) {
            throw denied;
          }
          return base.fs.stat(path, options);
        }
      }
    };
    const named = await loadTranscript(platform, { agent: "grok", path: updates });
    const detected = await loadTranscript(platform, { path: updates });
    const namedSummary = await summarizeSession(platform, { agent: "grok", path: updates });
    const detectedSummary = await summarizeSession(platform, { path: updates });
    expect(named).toEqual(detected);
    expect(namedSummary).toEqual(named);
    expect(detectedSummary).toEqual(named);
    expect(named).toEqual({
      ok: false,
      error: { _tag: "ReadFailed", path: updates, message: denied.message, cause: denied }
    });
  });
});

describe("grok translation output pins", () => {
  const conformance = fileURLToPath(new URL("fixtures/grok/conformance", import.meta.url));

  /**
   * The records of one fixture's `updates.jsonl`, at their real offsets. The file path is a stable stand-in, so the
   * pins do not carry this checkout's absolute path; ids come from the file's base name, which is the same.
   */
  function fixtureRecords(name: string) {
    const file = `/grok/conformance/${name}/updates.jsonl`;
    const text = readFileSync(`${conformance}/${name}/updates.jsonl`, "utf8");
    const out: { value: unknown; file: string; line: number; offset: number; length: number }[] = [];
    let offset = 0;
    for (const [index, row] of text.split("\n").entries()) {
      const length = Buffer.byteLength(row);
      if (row.trim()) {
        out.push({ value: JSON.parse(row), file, line: index + 1, offset, length });
      }
      offset += length + 1;
    }
    return { records: out, rows: text.split("\n") };
  }

  /** The subagent meta maps the loader reads from the `subagents` directories, keyed by directory name. */
  const SUBAGENTS: Record<string, Record<string, { id?: string; title?: string }>> = {
    subagent: {
      "child-1": { id: "child-1", title: "Look around" },
      "only-meta": { id: "meta-only", title: "From meta" }
    },
    "subagent-meta-id": { "run-9": { id: "worker-actual", title: "From meta" }, byname: { title: "Named by dir" } }
  };

  const FIXTURE_NAMES = [
    "plain",
    "compaction",
    "subagent",
    "tool-title",
    "unknown-type",
    "tool-progress",
    "duplicate-turn",
    "subagent-meta-id"
  ];

  it("pins the whole translation of every conformance fixture", () => {
    for (const name of FIXTURE_NAMES) {
      const { records } = fixtureRecords(name);
      const subagents = SUBAGENTS[name];
      const parsed = value(
        translateGrokRecords(records, subagents === undefined ? {} : { subagents: new Map(Object.entries(subagents)) })
      );
      expect({
        events: parsed.events,
        skipped: parsed.skipped,
        session: parsed.session,
        agents: parsed.agents
      }).toMatchSnapshot(`${name}: events, skipped, session and agents`);
    }
  });

  it("keeps a skipped record to its source pointer alone, without the record value", () => {
    const { records, rows } = fixtureRecords("tool-progress");
    const offsetOf = (line: number): number => {
      let offset = 0;
      for (let index = 0; index < line - 1; index++) {
        offset += Buffer.byteLength(rows[index]!) + 1;
      }
      return offset;
    };
    const parsed = value(translateGrokRecords(records));
    expect(parsed.skipped).toEqual(
      [4, 5, 6].map((line) => ({
        reason: "tool-progress",
        source: {
          file: `/grok/conformance/tool-progress/updates.jsonl`,
          offset: offsetOf(line),
          length: Buffer.byteLength(rows[line - 1]!),
          line
        }
      }))
    );
  });
});

describe("grok lenient reading", () => {
  it("reads a field of an unexpected type as absent", () => {
    const parsed = value(
      translateGrokRecords([
        grokRecord(
          { sessionUpdate: "user_message_chunk", content: "First", _meta: { promptIndex: "0", modelId: 7 } },
          1
        ),
        grokRecord({ sessionUpdate: 7, content: "not an update" }, 2),
        grokRecord(
          { sessionUpdate: "turn_completed", elapsed_ms: "25", usage: { inputTokens: 15, outputTokens: 4 } },
          3
        ),
        grokRecord({ sessionUpdate: "subagent_spawned", subagent_id: 7, description: "Look", status: 1 }, 4)
      ])
    );
    expect(parsed.events.find((event) => event.kind === "request")?.payload).toEqual({
      granularity: "turn",
      usage: { inputTokens: 15, outputTokens: 4, totalTokens: 19 }
    });
    expect(parsed.events.some((event) => event.payload.type === "turn_duration")).toBe(false);
    expect(parsed.events.find((event) => event.payload.type === "subagent_spawned")?.payload).toEqual({
      type: "subagent_spawned"
    });
    expect(parsed.agents.map((agent) => agent.id)).toEqual(["main"]);
    expect(parsed.events.filter((event) => event.kind === "user").map((event) => event.payload)).toEqual([
      { text: "First" }
    ]);
    expect(parsed.events.find((event) => event.kind === "unknown")?.payload).toEqual({ type: "update" });
  });

  it("keeps the hook runs it can read and drops the rest", () => {
    const parsed = value(
      translateGrokRecords([
        grokRecord({ sessionUpdate: "hook_execution", runs: "once" }, 1),
        grokRecord(
          {
            sessionUpdate: "hook_execution",
            runs: [
              "junk",
              { name: 5, status: "done" },
              { name: "lint", status: { status: "ok", elapsed_ms: "5", exit_code: 3 } }
            ]
          },
          2
        )
      ])
    );
    expect(parsed.events.filter((event) => event.kind === "hook").map((event) => event.payload.runs)).toEqual([
      [],
      [{}, { name: "lint", status: "ok", exitCode: 3 }]
    ]);
  });

  it("treats a present formatVersion as another generation and a wrong-typed schema_version as absent", () => {
    const record = {
      timestamp: 1767225600,
      params: { update: { sessionUpdate: "user_message_chunk", content: "x" } },
      formatVersion: 2
    };
    expect(translateGrokRecords([{ value: record, file: "updates.jsonl", line: 1, offset: 0, length: 1 }])).toEqual({
      ok: false,
      error: { _tag: "UnknownFormatGeneration", agent: "grok", file: "updates.jsonl", line: 1 }
    });
    const lenient = value(
      translateGrokRecords([grokRecord({ sessionUpdate: "user_message_chunk", content: "x", schema_version: "2" }, 1)])
    );
    expect(lenient.events[0]?.payload).toEqual({ text: "x" });
  });
});

describe("grok coalesce fallback", () => {
  it("falls back to the status field when a hook run's own exit_code or output has the wrong type", () => {
    const parsed = value(
      translateGrokRecords([
        grokRecord(
          {
            sessionUpdate: "hook_execution",
            runs: [
              { exit_code: "x", status: { status: "ok", exit_code: 3 } },
              { output: 5, status: { status: "ok", output: "from status" } }
            ]
          },
          1
        )
      ])
    );
    expect(parsed.events.find((event) => event.kind === "hook")?.payload.runs).toEqual([
      { status: "ok", exitCode: 3 },
      { status: "ok", output: "from status" }
    ]);
  });

  it("falls back to tokens_used when tokens_before has the wrong type", () => {
    const parsed = value(
      translateGrokRecords([
        grokRecord(
          { sessionUpdate: "auto_compact_completed", tokens_before: "500", tokens_used: 500, tokens_after: 80 },
          1
        )
      ])
    );
    expect(parsed.events.find((event) => event.kind === "compaction")?.payload).toEqual({
      trigger: "auto",
      preTokens: 500,
      postTokens: 80
    });
  });
});

describe("grok decoder cursor state", () => {
  /** One `decodeUsage` step: the records it reports and the cursor to continue from. */
  async function step(
    platform: Parameters<typeof createMemoryPlatform>[0] extends never
      ? never
      : ReturnType<typeof createMemoryPlatform>,
    path: string,
    options: DecodeUsageOptions
  ): Promise<{ records: UsageRecord[]; cursor: UsageCursor | undefined }> {
    const stream = decodeUsage(platform, "grok", { path }, options);
    const records: UsageRecord[] = [];
    for await (const item of stream) {
      if (!isUsageRecord(item)) {
        throw new Error(`${path}: ${JSON.stringify(item.error)}`);
      }
      records.push(item);
    }
    const cursor = stream.cursor === undefined ? undefined : (JSON.parse(JSON.stringify(stream.cursor)) as UsageCursor);
    return { records, cursor };
  }

  it("forgets a turn's model at a turn_completed without usage, also across a saved cursor", async () => {
    const dir = "/u/me/.grok/sessions/no-usage-turn";
    const path = `${dir}/updates.jsonl`;
    const updates = [
      {
        sessionUpdate: "user_message_chunk",
        content: { type: "text", text: "Go" },
        _meta: { promptIndex: 0, modelId: "grok-a" }
      },
      { sessionUpdate: "turn_completed", prompt_id: "p-1", stop_reason: "cancelled" },
      {
        sessionUpdate: "user_message_chunk",
        content: { type: "text", text: "Again" },
        _meta: { promptIndex: 0 }
      },
      {
        sessionUpdate: "turn_completed",
        prompt_id: "p-2",
        stop_reason: "end_turn",
        usage: { inputTokens: 1, outputTokens: 1, modelUsage: { "grok-b": { inputTokens: 1, outputTokens: 1 } } }
      }
    ];
    const full = updates
      .map(
        (update, index) =>
          `${JSON.stringify({ method: "session/update", timestamp: 1767225600 + index, params: { update } })}\n`
      )
      .join("");
    const half = updates
      .slice(0, 2)
      .map(
        (update, index) =>
          `${JSON.stringify({ method: "session/update", timestamp: 1767225600 + index, params: { update } })}\n`
      )
      .join("");
    const files = { [path]: half };
    const platform = createMemoryPlatform({ files, home: "/u/me" });

    // The first step ends on the usage-less `turn_completed`; its cursor carries the decoder state forward.
    const first = await step(platform, path, { final: false });
    expect(first.records).toEqual([]);

    await platform.fs.writeAtomic(path, new TextEncoder().encode(full));
    const second = await step(platform, path, { from: first.cursor, final: true });
    expect(second.records).toHaveLength(1);
    expect(second.records[0]).toMatchObject({ requestId: "p-2", model: "grok-b" });
  });
});
