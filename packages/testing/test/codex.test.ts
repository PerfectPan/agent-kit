import { fileURLToPath } from "node:url";

import type { Result } from "@rivus/agent-kit-catalog";
import {
  builtinSessionAdapters,
  foldTranscript,
  isSessionHead,
  listSessions,
  loadTranscript,
  mergeByTime,
  type SessionHead,
  type SessionListFailure,
  summarizeSession,
  timedRecord,
  translateCodexRecords,
  type Transcript
} from "@rivus/agent-kit-sessions";
import { describe, expect, it } from "vite-plus/test";

import { createMemoryPlatform, type MemoryPlatform } from "../src/memory-platform.js";
import { readTree } from "./support.js";

const tree = await readTree(fileURLToPath(new URL("fixtures/codex", import.meta.url)), "/u/me/.codex/fx");
const platform = createMemoryPlatform({ files: tree, home: "/u/me" });
const rollout = (name: string) => `/u/me/.codex/fx/conformance/rollout-${name}.jsonl`;

function value<T>(result: Result<T, unknown>): T {
  if (!result.ok) {
    throw new Error(`unexpected failure: ${JSON.stringify(result.error)}`);
  }
  return result.value;
}

const load = async (name: string): Promise<Transcript> =>
  value(await loadTranscript(platform, { agent: "codex", path: rollout(name) }));
const requests = (transcript: Pick<Transcript, "events">) =>
  transcript.events.filter((event) => event.kind === "request");

// oxlint-disable-next-line require-yield -- an iterator that fails on its first pull, like an unreadable file
async function* failing(error: Error): AsyncGenerator<Uint8Array> {
  throw error;
}

const at = (ms: number) => new Date(Date.UTC(2026, 0, 1) + ms).toISOString();

/** Records of one rollout, stamped like the adapter stamps them. */
function stamped(values: unknown[]) {
  return mergeByTime([
    values
      .map((value, index) => ({ value, file: "r.jsonl", line: index + 1, offset: index, length: 1 }))
      .map(timedRecord)
  ]);
}

describe("codex translation", () => {
  it("places one request per token_usage_record before the call output", async () => {
    const transcript = await load("plain");
    expect(transcript).toMatchObject({ agent: "codex", agentVersion: "0.1.0", session: { id: "cx-plain" } });
    expect(transcript.events.map((event) => event.kind)).toEqual([
      "user",
      "user",
      "request",
      "reasoning",
      "tool_call",
      "tool_result",
      "request",
      "assistant",
      "system"
    ]);
    expect(requests(transcript).map((event) => event.payload)).toEqual([
      {
        model: "gpt-test",
        responseId: "resp-1",
        usage: {
          inputTokens: 12,
          outputTokens: 3,
          totalTokens: 15,
          cacheReadTokens: 2,
          cacheWriteTokens: 1,
          reasoningTokens: 1
        }
      },
      {
        model: "gpt-test",
        responseId: "resp-2",
        usage: {
          inputTokens: 20,
          outputTokens: 5,
          totalTokens: 25,
          cacheReadTokens: 4,
          cacheWriteTokens: 0,
          reasoningTokens: 0
        }
      }
    ]);
    expect(transcript.events.find((event) => event.kind === "tool_result")?.payload).toMatchObject({
      isError: true,
      exitCode: 1
    });
    expect(transcript.events.at(-1)?.payload).toEqual({ type: "turn_duration", durationMs: 6500 });
    expect(transcript.skipped.map((skip) => skip.reason)).toEqual([
      "session-meta",
      "turn-context",
      "task-marker",
      "other-usage-source",
      "other-usage-source"
    ]);
    expect(foldTranscript(transcript)).toMatchObject({ turns: 1, durationMs: 6500, contextShape: [12, 20] });
    for (let index = 1; index < transcript.events.length; index++) {
      expect(transcript.events[index]!.ts).toBeGreaterThanOrEqual(transcript.events[index - 1]!.ts);
    }
  });

  it("takes the system prompt from session_meta.base_instructions only when the rollout records it", async () => {
    const plain = await load("plain");
    expect(plain.session.systemPrompt).toBe("Be brief.");
    expect(plain.capabilities).toContain("systemPrompt");
    const bare = await load("token-count");
    expect(bare.session.systemPrompt).toBeUndefined();
    expect(bare.capabilities).not.toContain("systemPrompt");
  });

  it("uses token_count before the first token_usage_record, preferring last_token_usage over the totals' increase", async () => {
    const transcript = await load("token-count");
    // The first count's totals include 100 earlier input tokens: last_token_usage (4) wins over their increase (104).
    expect(requests(transcript).map((event) => event.payload)).toEqual([
      {
        model: "gpt-count",
        usage: {
          inputTokens: 4,
          outputTokens: 1,
          totalTokens: 5,
          cacheReadTokens: 1,
          cacheWriteTokens: 0,
          reasoningTokens: 0
        }
      },
      {
        model: "gpt-count",
        usage: {
          inputTokens: 5,
          outputTokens: 2,
          totalTokens: 7,
          cacheReadTokens: 1,
          cacheWriteTokens: 0,
          reasoningTokens: 0
        }
      },
      {
        model: "gpt-next",
        responseId: "resp-3",
        usage: {
          inputTokens: 6,
          outputTokens: 1,
          totalTokens: 7,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          reasoningTokens: 0
        }
      }
    ]);
    expect(transcript.events.map((event) => event.kind)).toEqual([
      "user",
      "request",
      "reasoning",
      "request",
      "assistant",
      "user",
      "request",
      "assistant"
    ]);
    expect(transcript.events.find((event) => event.kind === "reasoning")?.payload).toEqual({ redacted: true });
    expect(transcript.skipped.map((skip) => skip.reason)).toEqual([
      "session-meta",
      "turn-context",
      "empty-usage",
      "unchanged-usage",
      "turn-context",
      "other-usage-source"
    ]);
  });

  it("skips the replayed prefix of a forked rollout for usage and turn durations", async () => {
    const transcript = await load("fork");
    expect(transcript.events.map((event) => event.kind)).toEqual([
      "user",
      "assistant",
      "user",
      "request",
      "reasoning",
      "assistant",
      "system",
      "user",
      "request",
      "assistant",
      "system"
    ]);
    expect(requests(transcript).map((event) => event.payload)).toEqual([
      {
        model: "gpt-fork",
        usage: { inputTokens: 120, outputTokens: 8, totalTokens: 128, cacheReadTokens: 60, reasoningTokens: 2 }
      },
      {
        model: "gpt-fork",
        usage: { inputTokens: 130, outputTokens: 6, totalTokens: 136, cacheReadTokens: 100, reasoningTokens: 0 }
      }
    ]);
    expect(transcript.events.slice(0, 2).every((event) => event.requestId === undefined)).toBe(true);
    expect(transcript.skipped.map((skip) => [skip.source.line, skip.reason])).toEqual([
      [1, "session-meta"],
      [2, "task-marker"],
      [3, "turn-context"],
      [6, "fork-replay"],
      [7, "fork-replay"],
      [8, "fork-replay"],
      [9, "task-marker"],
      [10, "turn-context"],
      [16, "task-marker"]
    ]);
    expect(foldTranscript(transcript)).toMatchObject({
      requests: 2,
      inputTokens: 250,
      outputTokens: 14,
      durationMs: 5000
    });
  });

  it("ends the replay at the first turn created after the fork, however many parent calls it copied", async () => {
    const oneCall = await load("fork-one-call");
    expect(oneCall.skipped.filter((skip) => skip.reason === "fork-replay").map((skip) => skip.source.line)).toEqual([
      6, 7
    ]);
    expect(foldTranscript(oneCall)).toMatchObject({
      requests: 2,
      inputTokens: 250,
      outputTokens: 14,
      durationMs: 5000
    });
    // Turn ids carry their creation time, so a rollout written within one millisecond still splits at its own turn.
    const v7 = (iso: string) => {
      const hex = Date.parse(iso).toString(16).padStart(12, "0");
      return `${hex.slice(0, 8)}-${hex.slice(8)}-7000-8000-000000000000`;
    };
    const record = (type: string, payload: Record<string, unknown>) => ({ timestamp: at(0), type, payload });
    const turn = (iso: string) => record("event_msg", { type: "task_started", turn_id: v7(iso) });
    const count = (input: number) =>
      record("event_msg", {
        type: "token_count",
        info: { last_token_usage: { input_tokens: input, output_tokens: 1 } }
      });
    const result = translateCodexRecords(
      stamped([
        record("session_meta", { id: v7("2026-01-01T00:00:00.000Z"), forked_from_id: "p" }),
        turn("2025-12-31T23:00:00.000Z"),
        count(10),
        turn("2026-01-01T00:00:00.000Z"),
        count(20)
      ])
    );
    expect(result.ok && requests(result.value).map((event) => event.payload.usage)).toEqual([
      { inputTokens: 20, outputTokens: 1, totalTokens: 21 }
    ]);
  });

  it("counts usage records in one second as replay only in a forked rollout", () => {
    const count = (ms: number, input: number) => ({
      timestamp: at(ms),
      type: "event_msg",
      payload: { type: "token_count", info: { last_token_usage: { input_tokens: input, output_tokens: 1 } } }
    });
    const meta = (payload: Record<string, unknown>) => ({ timestamp: at(0), type: "session_meta", payload });
    const usage = (records: unknown[]) => {
      const result = translateCodexRecords(stamped(records));
      return result.ok ? result.value.events.map((event) => event.payload.usage) : result.error;
    };
    expect(usage([meta({ id: "a" }), count(100, 1), count(200, 2)])).toEqual([
      { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
      { inputTokens: 2, outputTokens: 1, totalTokens: 3 }
    ]);
    expect(usage([meta({ id: "b", forked_from_id: "a" }), count(100, 1), count(200, 2), count(1500, 3)])).toEqual([
      { inputTokens: 3, outputTokens: 1, totalTokens: 4 }
    ]);
  });

  it("gives a cancelled turn's in-flight response a request of its own and leaves finished ones alone", () => {
    const call = {
      timestamp: at(1000),
      type: "response_item",
      payload: { type: "function_call", name: "shell", call_id: "c1" }
    };
    const usage = { timestamp: at(1500), type: "token_usage_record", payload: { turn_id: "t", response_id: "r1" } };
    const output = {
      timestamp: at(2000),
      type: "response_item",
      payload: { type: "function_call_output", call_id: "c1", output: "ok" }
    };
    const reasoning = { timestamp: at(4000), type: "response_item", payload: { type: "reasoning", summary: [] } };
    const notice = {
      timestamp: at(5000),
      type: "response_item",
      payload: {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: "<turn_aborted>\n</turn_aborted>" }]
      }
    };
    const aborted = { timestamp: at(6000), type: "event_msg", payload: { type: "turn_aborted", turn_id: "t" } };
    const finish = (records: unknown[]) => {
      const result = translateCodexRecords(stamped(records));
      return result.ok
        ? result.value.events.map((event) => [event.kind, event.requestId, event.payload.finishReason])
        : result.error;
    };
    // Cancelled while the tool ran: r1 has its usage record, so it finished.
    expect(finish([call, usage, aborted])).toEqual([
      ["request", "r1", undefined],
      ["tool_call", "r1", undefined]
    ]);
    expect(finish([call, usage, output, notice, aborted])).toEqual([
      ["request", "r1", undefined],
      ["tool_call", "r1", undefined],
      ["tool_result", undefined, undefined],
      ["user", undefined, undefined]
    ]);
    // Cancelled while the next response streamed: that response is the interrupted request.
    expect(finish([call, usage, output, reasoning, aborted])).toEqual([
      ["request", "r1", undefined],
      ["tool_call", "r1", undefined],
      ["tool_result", "L5", undefined],
      ["request", "L5", "interrupted"],
      ["reasoning", "L5", undefined]
    ]);
  });

  it("keeps a message by its id when a removed message has the same text", () => {
    const message = (id: string) => ({
      type: "message",
      id,
      role: "user",
      content: [{ type: "input_text", text: "continue" }]
    });
    const result = translateCodexRecords(
      stamped([
        { timestamp: at(1000), type: "response_item", payload: message("old") },
        { timestamp: at(2000), type: "response_item", payload: message("new") },
        { timestamp: at(3000), type: "compacted", payload: { message: "s", replacement_history: [message("new")] } }
      ])
    );
    expect(result.ok && result.value.events.map((event) => [event.id, event.shadowedBy])).toEqual([
      ["old", "L3"],
      ["new", undefined],
      ["L3", undefined]
    ]);
  });

  it("keeps as many equal messages as the history holds, the latest ones, with id matches choosing first", () => {
    const message = (text: string, id?: string) => ({
      type: "message",
      role: "user",
      content: [{ type: "input_text", text }],
      ...(id ? { id } : {})
    });
    const shadowed = (history: unknown[], messages = [message("continue"), message("continue")]) => {
      const records = [...messages, { message: "s", replacement_history: history }].map((payload, index) => ({
        timestamp: at(index * 1000),
        type: index === messages.length ? "compacted" : "response_item",
        payload
      }));
      const result = translateCodexRecords(stamped(records));
      return result.ok ? result.value.events.map((event) => [event.id, event.shadowedBy]) : result.error;
    };
    const kept = [
      ["L1", "L3"],
      ["L2", undefined],
      ["L3", undefined]
    ];
    expect(shadowed([message("continue")])).toEqual(kept);
    expect(shadowed([message("continue", "re-id")])).toEqual(kept);
    expect(shadowed([message("continue"), message("continue")])).toEqual([
      ["L1", undefined],
      ["L2", undefined],
      ["L3", undefined]
    ]);
    // The text item does not take "b", which the id item names, and keeps "a" instead.
    expect(shadowed([message("x"), message("x", "b")], [message("x", "a"), message("x", "b")])).toEqual([
      ["a", undefined],
      ["b", undefined],
      ["L3", undefined]
    ]);
  });

  it("links a subagent lane to the spawn_agent call whose task_name is the lane's agent path", () => {
    const result = translateCodexRecords(
      stamped([
        {
          timestamp: at(1000),
          type: "response_item",
          payload: { type: "function_call", name: "spawn_agent", call_id: "c" }
        },
        {
          timestamp: at(2000),
          type: "event_msg",
          payload: {
            type: "item_completed",
            item: {
              type: "SubAgentActivity",
              id: "a",
              agent_thread_id: "th-2",
              agent_path: "/root/scout",
              kind: "started"
            }
          }
        },
        {
          timestamp: at(3000),
          type: "response_item",
          payload: { type: "function_call_output", call_id: "c", output: '{"task_name":"/root/scout"}' }
        }
      ])
    );
    expect(result.ok && result.value.agents).toEqual([
      { id: "main" },
      { id: "th-2", parentId: "main", spawnEventId: "L1" }
    ]);
  });

  it("keeps replacement history by id or by role and text, and only shadows its own lane", async () => {
    const transcript = await load("compaction");
    const shadowed = transcript.events
      .filter((event) => event.shadowedBy)
      .map((event) => event.payload.text ?? event.kind);
    expect(shadowed).toEqual(["Forget this", "tool_call"]);
    // 'msg-8' is kept by role and text although the history item carries another id.
    expect(transcript.events.find((event) => event.id === "msg-8")?.shadowedBy).toBeUndefined();
    expect(transcript.events.find((event) => event.agentId === "child-1")?.shadowedBy).toBeUndefined();
  });

  it("records a subagent lane, an agent message and an injected developer message", async () => {
    const transcript = await load("subagent");
    expect(transcript.agents).toContainEqual({ id: "child-1", parentId: "main", spawnEventId: "L5" });
    expect(transcript.events.find((event) => event.id === "L5")?.payload).toMatchObject({ name: "spawn_agent" });
    expect(transcript.events.find((event) => event.payload.injected === true)?.kind).toBe("system");
    expect(transcript.events.find((event) => event.payload.type === "agent_message")?.payload).toEqual({
      type: "agent_message",
      author: "/root/child",
      recipient: "/root",
      text: "Done"
    });
    expect(transcript.skipped.map((skip) => skip.reason)).toEqual(["session-meta", "inter-agent"]);
    expect(foldTranscript(transcript).turns).toBe(1);
    expect(transcript.session.title).toBe("Delegate");
  });

  it("maps web and tool search to tool calls, keeps unknown types and skips a line that is not JSON", async () => {
    const transcript = await load("unknown");
    expect(transcript.events.filter((event) => event.kind === "unknown").map((event) => event.payload.type)).toEqual([
      "mystery_box",
      "mystery_event"
    ]);
    expect(transcript.events.filter((event) => event.kind === "tool_call").map((event) => event.payload)).toEqual([
      { callId: "", name: "web_search", args: { type: "search", query: "vitest", queries: ["vitest"] } },
      { callId: "call-ts", name: "tool_search", args: { query: "calendar", limit: 5 } }
    ]);
    const result = transcript.events.find((event) => event.kind === "tool_result");
    expect(result?.payload.callId).toBe("call-ts");
    expect(result?.payload.orphan).toBeUndefined();
    expect(transcript.skipped.map((skip) => [skip.source.line, skip.reason])).toEqual([
      [1, "session-meta"],
      [4, "invalid-json"]
    ]);
  });

  it("reads an older rollout with a header record and bare items", async () => {
    const transcript = await load("legacy");
    expect(transcript.session.id).toBe("cx-legacy");
    expect(transcript.events.map((event) => [event.id, event.kind])).toEqual([
      ["L3", "user"],
      ["rs-1", "reasoning"],
      ["fc-1", "tool_call"],
      ["L7", "tool_result"],
      ["msg-l2", "assistant"]
    ]);
    expect(transcript.events.find((event) => event.kind === "tool_call")?.payload.args).toEqual({ command: ["ls"] });
    expect(transcript.events.find((event) => event.kind === "tool_result")?.payload).toMatchObject({
      exitCode: 0,
      isError: false
    });
    expect(transcript.events.every((event) => event.ts === Date.parse("2025-09-01T10:00:00.000Z"))).toBe(true);
    expect(transcript.skipped.map((skip) => skip.reason)).toEqual([
      "legacy-header",
      "record-state",
      "record-state",
      "record-state"
    ]);
  });

  it("returns an unknown format generation as a tagged failure, from the load and from the translation", async () => {
    const path = "/u/me/.codex/fx/unknown-generation/rollout-bad.jsonl";
    expect(await loadTranscript(platform, { agent: "codex", path })).toEqual({
      ok: false,
      error: { _tag: "UnknownFormatGeneration", agent: "codex", file: path, line: 1 }
    });
    expect(translateCodexRecords(stamped([{ payload: {} }]))).toEqual({
      ok: false,
      error: { _tag: "UnknownFormatGeneration", agent: "codex", file: "r.jsonl", line: 1 }
    });
  });
});

describe("sessions use cases over Codex", () => {
  it("returns a missing or unreadable rollout as a tagged failure", async () => {
    expect(await loadTranscript(platform, { agent: "codex", path: rollout("gone") })).toEqual({
      ok: false,
      error: { _tag: "SessionNotFound", path: rollout("gone") }
    });
    const denied = Object.assign(new Error("EACCES: permission denied"), { code: "EACCES" });
    const locked = {
      fs: {
        ...platform.fs,
        read(path: string, range?: { start: number; end?: number }) {
          return path === rollout("plain") ? failing(denied) : platform.fs.read(path, range);
        }
      }
    };
    expect(await loadTranscript(locked, { agent: "codex", path: rollout("plain") })).toEqual({
      ok: false,
      error: { _tag: "ReadFailed", path: rollout("plain"), message: denied.message, cause: denied }
    });
  });

  async function list(on: MemoryPlatform): Promise<(SessionHead | SessionListFailure)[]> {
    const items: (SessionHead | SessionListFailure)[] = [];
    for await (const item of listSessions(on, { agents: ["codex"] })) {
      items.push(item);
    }
    return items;
  }

  it("lists sessions and archived sessions, titled by the first prompt Codex did not inject", async () => {
    const home = createMemoryPlatform({
      files: {
        "/u/me/.codex/sessions/2026/01/01/rollout-plain.jsonl": tree[rollout("plain")]!,
        "/u/me/.codex/archived_sessions/rollout-subagent.jsonl": tree[rollout("subagent")]!
      },
      home: "/u/me"
    });
    const items = await list(home);
    expect(items.every(isSessionHead)).toBe(true);
    expect(items).toMatchObject([
      {
        ref: { agent: "codex", path: "/u/me/.codex/sessions/2026/01/01/rollout-plain.jsonl", sessionId: "cx-plain" },
        title: "Run the tests",
        firstPrompt: "Run the tests",
        cwd: "/work/app",
        startedAt: Date.parse("2026-01-01T00:00:00.000Z")
      },
      { ref: { path: "/u/me/.codex/archived_sessions/rollout-subagent.jsonl", sessionId: "cx-sub" }, title: "Delegate" }
    ]);
  });

  it("reads the home from CODEX_HOME and reports a missing root as a failure item", async () => {
    const moved = createMemoryPlatform({
      files: { "/cfg/codex/sessions/rollout-a.jsonl": tree[rollout("legacy")]! },
      env: { CODEX_HOME: "/cfg/codex" }
    });
    expect(await list(moved)).toMatchObject([
      { ref: { path: "/cfg/codex/sessions/rollout-a.jsonl" }, firstPrompt: "List the files" },
      { error: { _tag: "RootMissing", path: "/cfg/codex/archived_sessions" } }
    ]);
  });

  it("detects a Codex session without a named agent and summarizes it like folding its transcript", async () => {
    const copy = createMemoryPlatform({ files: { "/x/session.jsonl": tree[rollout("plain")]! } });
    expect(value(await loadTranscript(copy, { path: "/x/session.jsonl" })).agent).toBe("codex");
    expect(value(await summarizeSession(platform, { agent: "codex", path: rollout("plain") }))).toEqual({
      turns: 1,
      requests: 2,
      inputTokens: 32,
      outputTokens: 8,
      durationMs: 6500,
      compactions: 0,
      subagents: 0,
      failedTools: 1,
      contextShape: [12, 20]
    });
  });

  it("returns ReadFailed when automatic detection cannot read an exported session", async () => {
    const denied = Object.assign(new Error("EACCES: permission denied"), { code: "EACCES" });
    const exported = createMemoryPlatform({ files: { "/export/session.jsonl": "{}\n" } });
    const locked = { fs: { ...exported.fs, read: () => failing(denied) } };
    const options = { adapters: { codex: builtinSessionAdapters["codex"] } };
    for (const run of [loadTranscript, summarizeSession]) {
      expect(await run(locked, { path: "/export/session.jsonl" }, options)).toEqual({
        ok: false,
        error: { _tag: "ReadFailed", path: "/export/session.jsonl", message: denied.message, cause: denied }
      });
    }
  });
});

describe("codex skipped records", () => {
  it("reports whole skipped entries whose sources carry no record", async () => {
    const transcript = await load("duplicate-usage");
    const path = rollout("duplicate-usage");
    const text = new TextDecoder().decode(tree[path]!);
    const lines = text.split("\n").filter((line) => line.trim() !== "");
    let offset = 0;
    const sources = lines.map((line, index) => {
      const source = {
        file: path,
        offset,
        length: Buffer.byteLength(line),
        line: index + 1
      };
      offset += Buffer.byteLength(line) + 1;
      return source;
    });
    expect(transcript.skipped).toEqual([
      { reason: "session-meta", source: sources[0] },
      { reason: "duplicate-usage", source: sources[2] }
    ]);
  });
});
