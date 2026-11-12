import { grok } from "../src/identity.js";
import { grokUsageDecoder } from "../src/usage.js";
import { grokSessionAdapter, translateGrokRecords } from "../src/sessions.js";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import type { Result } from "@rivus/agent-kit-catalog/public";
import type { FileStat } from "@rivus/agent-kit-platform/public";
import {
  decodeUsage,
  foldTranscript,
  isSessionHead,
  isUsageRecord,
  listSessions,
  loadTranscript,
  type DecodeUsageOptions,
  type SessionHead,
  type Transcript,
  type UsageCursor,
  type UsageRecord
} from "@rivus/agent-kit-sessions/public";
import { describe, expect, it } from "vite-plus/test";

import { createMemoryPlatform } from "@rivus/agent-kit-testing/public";
import { readTree } from "../../../testing/test/support.js";

const testIdentity = { grok };
const testSessions = { grok: grokSessionAdapter };
const builtinSessionAdapters = testSessions;
const testUsage = { grok: grokUsageDecoder };

const tree = await readTree(fileURLToPath(new URL("fixtures/sessions", import.meta.url)), "/u/me/.grok/sessions");
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
  value(
    await loadTranscript(
      platform,
      { agent: "grok", path: session(name) },
      { providers: { sessions: testSessions, identity: testIdentity } }
    )
  );

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
      event: "PostToolUse",
      name: "shell",
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

  it("shows one request per model call when events.jsonl and chat_history.jsonl join several", async () => {
    const transcript = await load("conformance/per-call");
    const requests = transcript.events.filter((event) => event.kind === "request");
    // Turn 0 ran two calls; its repeated `turn_completed` and the single-call turn 1 keep turn-level requests.
    expect(requests.map((event) => [event.requestId, event.payload.granularity, event.payload.model])).toEqual([
      ["0#0", "request", "grok-test-build"],
      ["0#1", "turn", "grok-test"],
      ["0", "turn", undefined],
      ["1", "turn", "grok-test"]
    ]);
    // `updates.jsonl` names whole seconds: a request takes its first output's time when the `first_token` falls later.
    expect(requests[1]?.ts).toBe(Date.parse("2026-01-01T00:00:03.000Z"));
    expect(requests[0]?.ts).toBe(Date.parse("2026-01-01T00:00:01.000Z"));
    expect(requests[1]?.payload.usage).toEqual({ inputTokens: 15, outputTokens: 4, totalTokens: 19 });
    const members = (id: string) =>
      transcript.events
        .filter((event) => event.requestId === id && event.kind !== "request")
        .map((event) => event.kind);
    expect(members("0#0")).toEqual(["user", "reasoning", "tool_call", "tool_result", "hook"]);
    expect(members("0#1")).toEqual(["assistant"]);
    const summary = foldTranscript(transcript);
    expect(summary.requests).toBe(4);
    expect(summary.contextShape).toEqual([15, 30]);
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
    for await (const item of listSessions(platform, {
      agents: ["grok"],
      providers: { sessions: testSessions, identity: testIdentity }
    })) {
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
    expect(
      await loadTranscript(
        platform,
        { agent: "grok", path },
        { providers: { sessions: testSessions, identity: testIdentity } }
      )
    ).toEqual({
      ok: false,
      error: { _tag: "UnknownFormatGeneration", agent: "grok", file: path, line: 1 }
    });
    const summary = "/u/me/.grok/sessions/bad-summary/summary.json";
    expect(
      await loadTranscript(
        platform,
        { agent: "grok", path: session("bad-summary") },
        { providers: { sessions: testSessions, identity: testIdentity } }
      )
    ).toEqual({
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
    const transcript = value(
      await loadTranscript(
        broken,
        { agent: "grok", path: `${dir}/updates.jsonl` },
        { providers: { sessions: testSessions, identity: testIdentity } }
      )
    );
    expect(transcript.skipped.map((skip) => skip.reason)).toEqual(["invalid-json", "invalid-json"]);
    expect(transcript.skipped.map((skip) => skip.source.file)).toEqual([
      `${dir}/summary.json`,
      `${dir}/tool_definitions.json`
    ]);
    expect(transcript.session.tools).toBeUndefined();
    expect(transcript.events[0]?.payload.type).toBe("widget");
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
        for await (const item of listSessions(platform, {
          agents: ["grok"],
          signal: controller.signal,
          providers: { sessions: testSessions, identity: testIdentity }
        })) {
          seen.push(item);
        }
      })()
    ).rejects.toBe(reason);
    expect(seen).toEqual([]);
  });
});

describe("grok translation output pins", () => {
  const conformance = fileURLToPath(new URL("fixtures/sessions/conformance", import.meta.url));

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

describe("grok decoder cursor state", () => {
  /** One `decodeUsage` step: the records it reports and the cursor to continue from. */
  async function step(
    platform: Parameters<typeof createMemoryPlatform>[0] extends never
      ? never
      : ReturnType<typeof createMemoryPlatform>,
    path: string,
    options: DecodeUsageOptions
  ): Promise<{ records: UsageRecord[]; cursor: UsageCursor | undefined }> {
    const stream = decodeUsage(
      platform,
      "grok",
      { path },
      { ...options, providers: { usage: testUsage, identity: testIdentity } }
    );
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
