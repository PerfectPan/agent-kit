import { describe, expect, it } from "vite-plus/test";

import { translateGrokRecords } from "./grok/events.js";
import { foldStreamParts, type SourcedRecord, type TranscriptStreamPart } from "../index.js";
import {
  acpChunkText,
  acpToolCallPayload,
  acpUsage,
  createAcpPartTranslator,
  mergeAcpToolStatus,
  mergeAcpToolUpdate,
  type AcpToolState
} from "./acp-updates.js";

const chunk = (sessionUpdate: string, text: string, messageId?: string) => ({
  sessionUpdate,
  content: { type: "text", text },
  ...(messageId ? { messageId } : {})
});

/** The parts of a list of updates and a final answer, through one translator. */
function translate(updates: readonly Record<string, unknown>[], stopReason = "end_turn"): TranscriptStreamPart[] {
  const translator = createAcpPartTranslator("t.");
  return [...updates.flatMap((update) => translator.update(update)), ...translator.finish({ stopReason })];
}

const TOOL_UPDATES = [
  { sessionUpdate: "tool_call", toolCallId: "c1", title: "bash", status: "pending", rawInput: { cmd: "ls" } },
  { sessionUpdate: "tool_call_update", toolCallId: "c1", status: "in_progress", rawInput: null },
  {
    sessionUpdate: "tool_call_update",
    toolCallId: "c1",
    status: "failed",
    content: [{ type: "content", content: { type: "text", text: "no such dir" } }]
  }
];

describe("createAcpPartTranslator", () => {
  it("splits text and reasoning into parts that end when another kind or message starts", () => {
    const parts = translate([
      chunk("agent_thought_chunk", "hmm"),
      chunk("agent_message_chunk", "Hel", "m1"),
      chunk("agent_message_chunk", "lo", "m1"),
      chunk("agent_message_chunk", "", "m1"),
      chunk("agent_message_chunk", "Again", "m2")
    ]);
    expect(parts).toEqual([
      { type: "reasoning-start", id: "t.0" },
      { type: "reasoning-delta", id: "t.0", delta: "hmm" },
      { type: "reasoning-end", id: "t.0" },
      { type: "text-start", id: "t.1" },
      { type: "text-delta", id: "t.1", delta: "Hel" },
      { type: "text-delta", id: "t.1", delta: "lo" },
      { type: "text-end", id: "t.1" },
      { type: "text-start", id: "t.2" },
      { type: "text-delta", id: "t.2", delta: "Again" },
      { type: "text-end", id: "t.2" },
      { type: "finish", id: "t.3", finishReason: "end_turn" }
    ]);
  });

  it("reports a tool's input when an update supplies it and its output once, when it ends", () => {
    expect(translate(TOOL_UPDATES)).toEqual([
      { type: "tool-input-start", toolCallId: "c1", toolName: "bash" },
      { type: "tool-input-available", toolCallId: "c1", toolName: "bash", input: { cmd: "ls" } },
      { type: "tool-output-error", toolCallId: "c1", errorText: "no such dir", output: "no such dir" },
      { type: "finish", id: "t.0", finishReason: "end_turn" }
    ]);
  });

  it("names a failed call's output tool-output-error, as AI SDK does, and folds it into an error result", () => {
    const failed = {
      sessionUpdate: "tool_call",
      toolCallId: "c2",
      title: "fetch",
      status: "failed",
      rawOutput: { code: 7 }
    };
    const parts = translate([failed]);
    expect(parts[1]).toEqual({
      type: "tool-output-error",
      toolCallId: "c2",
      errorText: "the tool call failed",
      output: { code: 7 }
    });
    expect(foldStreamParts(parts, () => 1)[1]?.payload).toEqual({ callId: "c2", isError: true, output: { code: 7 } });
  });

  it("keeps other updates whole: user chunks as user events, session updates as system, the rest unknown", () => {
    const plan = { sessionUpdate: "plan", entries: [] };
    const odd = { sessionUpdate: "something_new" };
    const parts = translate([chunk("user_message_chunk", "hi"), plan, odd]);
    expect(parts.slice(0, 3)).toEqual([
      { type: "update", id: "t.0", kind: "user", payload: { text: "hi" }, original: chunk("user_message_chunk", "hi") },
      { type: "update", id: "t.1", kind: "system", payload: { type: "plan" }, original: plan },
      { type: "update", id: "t.2", kind: "unknown", payload: { type: "something_new" }, original: odd }
    ]);
  });
});

describe("foldStreamParts", () => {
  it("completes text at its end, a tool call with its result, and the request at finish", () => {
    const parts = translate([chunk("agent_message_chunk", "Hi"), ...TOOL_UPDATES], "cancelled");
    const events = foldStreamParts(parts, () => 5);
    expect(events).toEqual([
      { id: "assistant:t.0", seq: 0, ts: 5, kind: "assistant", payload: { text: "Hi" } },
      {
        id: "tool_call:c1",
        seq: 1,
        ts: 5,
        kind: "tool_call",
        payload: { callId: "c1", name: "bash", args: { cmd: "ls" } }
      },
      {
        id: "tool_result:c1",
        seq: 2,
        ts: 5,
        kind: "tool_result",
        payload: { callId: "c1", isError: true, output: "no such dir" }
      },
      {
        id: "request:t.1",
        seq: 3,
        ts: 5,
        kind: "request",
        payload: { granularity: "turn", finishReason: "cancelled" }
      }
    ]);
  });

  it("lists a call that never ended at finish, and skips the stream's own event parts", () => {
    const parts = translate([TOOL_UPDATES[0] ?? {}]);
    const events = foldStreamParts(parts, () => 1);
    expect(events.map((event) => event.kind)).toEqual(["tool_call", "request"]);
    const withEvents: TranscriptStreamPart[] = [
      ...parts,
      ...events.map((event) => ({ type: "event" as const, event }))
    ];
    expect(foldStreamParts(withEvents, () => 1)).toEqual(events);
  });
});

describe("acpUsage", () => {
  it("adds cache and thought tokens back, because ACP's total sums every count", () => {
    expect(
      acpUsage({
        totalTokens: 21,
        inputTokens: 10,
        outputTokens: 5,
        thoughtTokens: 2,
        cachedReadTokens: 3,
        cachedWriteTokens: 1
      })
    ).toEqual({
      inputTokens: 14,
      outputTokens: 7,
      totalTokens: 21,
      cacheReadTokens: 3,
      cacheWriteTokens: 1,
      reasoningTokens: 2
    });
    expect(acpUsage(undefined)).toBeUndefined();
  });

  it("reads a count of an unexpected type as absent, like every log field", () => {
    expect(acpUsage({ inputTokens: "10", outputTokens: Infinity, totalTokens: 5 })).toEqual({ totalTokens: 5 });
    expect(acpUsage({ inputTokens: NaN })).toBeUndefined();
  });
});

describe("lenient reading of one update", () => {
  it("reads text only from content a chunk shape can hold, and other shapes as empty", () => {
    expect(acpChunkText({ text: 5 })).toBe("");
    expect(acpChunkText(42)).toBe("");
    expect(acpChunkText({ content: { text: 7 } })).toBe("");
    expect(acpChunkText([{ text: 5 }, { content: { text: "kept" } }])).toBe("kept");
  });

  it("keeps an update whose fields have the wrong types as an unknown update, not a failure", () => {
    const translator = createAcpPartTranslator("t.");
    const typed = { sessionUpdate: 5, content: { text: "hi" } };
    expect(translator.update(typed)).toEqual([
      { type: "update", id: "t.0", kind: "unknown", payload: { type: "update" }, original: typed }
    ]);
    expect(
      translator.update({ sessionUpdate: "tool_call", toolCallId: 5, title: "bash", rawInput: { cmd: "ls" } })
    ).toEqual([
      { type: "tool-input-start", toolCallId: "", toolName: "bash" },
      { type: "tool-input-available", toolCallId: "", toolName: "bash", input: { cmd: "ls" } }
    ]);
  });

  it("reads a non-record update as an update with no fields", () => {
    const translator = createAcpPartTranslator("t.");
    // The interface names a record; the runtime keeps a caller honest by reading one that is not.
    expect(translator.update(42 as unknown as Record<string, unknown>)).toEqual([
      { type: "update", id: "t.0", kind: "unknown", payload: { type: "update" }, original: 42 }
    ]);
    expect(translator.update(null as unknown as Record<string, unknown>)).toEqual([
      { type: "update", id: "t.1", kind: "unknown", payload: { type: "update" }, original: null }
    ]);
  });
});

/** A Grok `tool_call` for `read_file` and the later `tool_call_update` that shows a display title and the full args. */
const GROK_TITLE_UPDATES = [
  {
    sessionUpdate: "tool_call",
    toolCallId: "c1",
    title: "read_file",
    rawInput: { path: "/u/me/x.md", background: false }
  },
  {
    sessionUpdate: "tool_call_update",
    toolCallId: "c1",
    title: "Read `/u/me/x.md`",
    rawInput: { path: "/u/me/x.md", variant: "content", "-i": false, type: "text", multiline: false },
    status: "completed",
    content: [{ type: "content", content: { type: "text", text: "file body" } }]
  }
] as const;

const MERGED_ARGS = {
  path: "/u/me/x.md",
  background: false,
  variant: "content",
  "-i": false,
  type: "text",
  multiline: false
};

describe("S89: Grok logs and live turns read ACP updates with the same rules", () => {
  /** The recorded events one list of updates produces, as `[kind, payload]` pairs, through the Grok translation. */
  const recordedOf = (
    updates: readonly Record<string, unknown>[],
    kinds: readonly string[] = ["tool_call"]
  ): [string, Record<string, unknown>][] => {
    const records: SourcedRecord[] = updates.map((update, index) => ({
      file: "updates.jsonl",
      offset: index * 100,
      length: 100,
      line: index + 1,
      value: { timestamp: "2026-01-01T00:00:00.000Z", params: { update } }
    }));
    const grok = translateGrokRecords(records);
    if (!grok.ok) {
      throw new Error(grok.error._tag);
    }
    return grok.value.events.filter((event) => kinds.includes(event.kind)).map((event) => [event.kind, event.payload]);
  };

  /** The events the same list of updates produces live, as `[kind, payload]` pairs, through one translator. */
  const liveOf = (
    updates: readonly Record<string, unknown>[],
    kinds: readonly string[] = ["tool_call"]
  ): [string, Record<string, unknown>][] =>
    foldStreamParts(translate(updates))
      .filter((event) => kinds.includes(event.kind))
      .map((event) => [event.kind, event.payload]);

  it("merges a tool call's updates into the same call and result", () => {
    expect(liveOf(TOOL_UPDATES, ["tool_call", "tool_result"])).toEqual(
      recordedOf(TOOL_UPDATES, ["tool_call", "tool_result"])
    );
  });

  it("reads a titled call and its display-title update to the same name, title and args on both paths", () => {
    expect(liveOf(GROK_TITLE_UPDATES)).toEqual(recordedOf(GROK_TITLE_UPDATES));
    expect(liveOf(GROK_TITLE_UPDATES)[0]?.[1]).toEqual({
      callId: "c1",
      name: "read_file",
      title: "Read `/u/me/x.md`",
      args: MERGED_ARGS
    });
  });

  it("carries a title-only later update into the live fold like the Grok log", () => {
    const updates = [
      { sessionUpdate: "tool_call", toolCallId: "c1", title: "bash", rawInput: { command: "ls" } },
      { sessionUpdate: "tool_call_update", toolCallId: "c1", title: "List files" }
    ];
    expect(liveOf(updates)).toEqual(recordedOf(updates));
    expect(liveOf(updates)[0]?.[1]).toEqual({
      callId: "c1",
      name: "bash",
      title: "List files",
      args: { command: "ls" }
    });
  });

  it("reads a display title that arrives on the completed update without input (OpenCode shape) on both paths", () => {
    const updates = [
      {
        sessionUpdate: "tool_call",
        toolCallId: "c1",
        title: "run_terminal_command",
        rawInput: { command: "ls -la" }
      },
      {
        sessionUpdate: "tool_call_update",
        toolCallId: "c1",
        title: "List `.`",
        status: "completed",
        content: "file one"
      }
    ];
    expect(liveOf(updates)).toEqual(recordedOf(updates));
    expect(liveOf(updates)[0]?.[1]).toEqual({
      callId: "c1",
      name: "run_terminal_command",
      title: "List `.`",
      args: { command: "ls -la" }
    });
  });

  it("clears the title again on both paths when a later title equals the name", () => {
    const updates = [
      { sessionUpdate: "tool_call", toolCallId: "c1", title: "bash", rawInput: { command: "ls" } },
      { sessionUpdate: "tool_call_update", toolCallId: "c1", title: "List files" },
      {
        sessionUpdate: "tool_call_update",
        toolCallId: "c1",
        title: "bash",
        status: "completed",
        content: "done"
      }
    ];
    const live = liveOf(updates);
    const recorded = recordedOf(updates);
    expect(live).toEqual(recorded);
    expect(live[0]?.[1]).toEqual({ callId: "c1", name: "bash", args: { command: "ls" } });
    expect("title" in live[0]![1]).toBe(false);
    expect("title" in recorded[0]![1]).toBe(false);
  });
});

describe("tool names and args across updates", () => {
  const merged = (updates: readonly Record<string, unknown>[]): AcpToolState | undefined => {
    const tools = new Map<string, AcpToolState>();
    for (const update of updates) {
      mergeAcpToolUpdate(tools, update);
    }
    return tools.get("c1");
  };

  it("names the call with its first non-empty title || toolName and keeps a later display title as title", () => {
    const state = merged(GROK_TITLE_UPDATES);
    expect(state?.name).toBe("read_file");
    expect(state?.title).toBe("Read `/u/me/x.md`");
    expect(acpToolCallPayload(state!)).toEqual({
      callId: "c1",
      name: "read_file",
      title: "Read `/u/me/x.md`",
      args: MERGED_ARGS
    });
  });

  it("falls back to toolName behind an empty title and keeps a later display title as title", () => {
    expect(merged([{ sessionUpdate: "tool_call", toolCallId: "c1", toolName: "read_file" }])?.name).toBe("read_file");
    expect(merged([{ sessionUpdate: "tool_call", toolCallId: "c1", title: "", toolName: "read_file" }])?.name).toBe(
      "read_file"
    );
    const named = merged([
      { sessionUpdate: "tool_call", toolCallId: "c1", title: "", toolName: "read_file" },
      { sessionUpdate: "tool_call_update", toolCallId: "c1", title: "Read `/u/me/x.md`" }
    ]);
    expect(named?.name).toBe("read_file");
    expect(named?.title).toBe("Read `/u/me/x.md`");
  });

  it("repeats a later title only while it differs from the name", () => {
    const state = merged([
      { sessionUpdate: "tool_call", toolCallId: "c1", title: "read_file" },
      { sessionUpdate: "tool_call_update", toolCallId: "c1", title: "Read `/u/me/x.md`" },
      { sessionUpdate: "tool_call_update", toolCallId: "c1", title: "read_file" }
    ]);
    expect(state?.name).toBe("read_file");
    expect(state?.title).toBeUndefined();
    expect(acpToolCallPayload(state!)).toEqual({ callId: "c1", name: "read_file" });
  });

  it("merges a plain-object rawInput into plain-object previous args and replaces any other shape", () => {
    const state = merged(GROK_TITLE_UPDATES);
    expect(state?.args).toEqual(MERGED_ARGS);
    expect(merged([{ toolCallId: "c1" }, { toolCallId: "c1", rawInput: { a: 1 } }])?.args).toEqual({ a: 1 });
    expect(
      merged([
        { toolCallId: "c1", rawInput: { a: 1 } },
        { toolCallId: "c1", rawInput: null }
      ])?.args
    ).toEqual({
      a: 1
    });
    // A previous args that is not a plain object, or an update that is not one, keeps the replace rule.
    expect(
      merged([
        { toolCallId: "c1", rawInput: { a: 1 } },
        { toolCallId: "c1", rawInput: [1] }
      ])?.args
    ).toEqual([1]);
    expect(
      merged([
        { toolCallId: "c1", rawInput: [1] },
        { toolCallId: "c1", rawInput: { a: 1 } }
      ])?.args
    ).toEqual({
      a: 1
    });
  });

  it("carries the name and the merged args through the live fold, with the display title on the parts", () => {
    const parts = translate(GROK_TITLE_UPDATES);
    expect(parts).toEqual([
      { type: "tool-input-start", toolCallId: "c1", toolName: "read_file" },
      {
        type: "tool-input-available",
        toolCallId: "c1",
        toolName: "read_file",
        input: { path: "/u/me/x.md", background: false }
      },
      {
        type: "tool-input-available",
        toolCallId: "c1",
        toolName: "read_file",
        title: "Read `/u/me/x.md`",
        input: MERGED_ARGS
      },
      { type: "tool-output-available", toolCallId: "c1", output: "file body" },
      { type: "finish", id: "t.0", finishReason: "end_turn" }
    ]);
    const events = foldStreamParts(parts, () => 1);
    expect(events.find((event) => event.kind === "tool_call")?.payload).toEqual({
      callId: "c1",
      name: "read_file",
      title: "Read `/u/me/x.md`",
      args: MERGED_ARGS
    });
  });

  it("reports a title change without new input as tool-input-available, clearing it when the name returns", () => {
    const translator = createAcpPartTranslator("t.");
    translator.update({ sessionUpdate: "tool_call", toolCallId: "c1", title: "bash", rawInput: { command: "ls" } });
    expect(translator.update({ sessionUpdate: "tool_call_update", toolCallId: "c1", title: "List files" })).toEqual([
      {
        type: "tool-input-available",
        toolCallId: "c1",
        toolName: "bash",
        input: { command: "ls" },
        title: "List files"
      }
    ]);
    expect(translator.update({ sessionUpdate: "tool_call_update", toolCallId: "c1", title: "bash" })).toEqual([
      { type: "tool-input-available", toolCallId: "c1", toolName: "bash", input: { command: "ls" } }
    ]);
  });
});

describe("mergeAcpToolStatus", () => {
  const statusOf = (updates: readonly Record<string, unknown>[]): string | undefined => {
    const full = new Map<string, AcpToolState>();
    const slim = new Map<string, AcpToolState>();
    let state: AcpToolState | undefined;
    for (const update of updates) {
      state = mergeAcpToolStatus(slim, update);
      mergeAcpToolUpdate(full, update);
    }
    // The slim mirror holds no text a summary pass must not keep, and its status matches the full merge's.
    expect(state).toEqual({ callId: "c1", name: "", ...(state?.status === undefined ? {} : { status: state.status }) });
    expect(state?.status).toBe(full.get("c1")?.status);
    return state?.status;
  };

  it("keeps the latest non-empty status, like the full merge", () => {
    expect(
      statusOf([
        { sessionUpdate: "tool_call", toolCallId: "c1" },
        { sessionUpdate: "tool_call_update", toolCallId: "c1", status: "pending" },
        { sessionUpdate: "tool_call_update", toolCallId: "c1", status: "failed" },
        { sessionUpdate: "tool_call_update", toolCallId: "c1", status: "completed" }
      ])
    ).toBe("completed");
    expect(statusOf([{ toolCallId: "c1", status: "failed" }, { toolCallId: "c1" }])).toBe("failed");
    expect(statusOf([{ toolCallId: "c1" }])).toBeUndefined();
  });

  it("reads a status the done predicates accept, and an empty string as absent", () => {
    expect(
      statusOf([
        { toolCallId: "c1", status: "" },
        { toolCallId: "c1", status: "in_progress" },
        { toolCallId: "c1", status: "error" }
      ])
    ).toBe("error");
  });
});
