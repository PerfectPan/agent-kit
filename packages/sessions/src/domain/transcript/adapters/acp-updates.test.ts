import { describe, expect, it } from "vitest";

import { translateGrokRecords } from "./grok/events.js";
import { foldStreamParts, type SourcedRecord, type TranscriptStreamPart } from "../index.js";
import { acpUsage, createAcpPartTranslator } from "./acp-updates.js";

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
});

describe("S89: Grok logs and live turns read ACP updates with the same rules", () => {
  it("merges a tool call's updates into the same call and result", () => {
    const records: SourcedRecord[] = TOOL_UPDATES.map((update, index) => ({
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
    const recorded = grok.value.events.filter((event) => event.kind === "tool_call" || event.kind === "tool_result");
    const live = foldStreamParts(translate(TOOL_UPDATES)).filter(
      (event) => event.kind === "tool_call" || event.kind === "tool_result"
    );
    expect(live.map((event) => [event.kind, event.payload])).toEqual(
      recorded.map((event) => [event.kind, event.payload])
    );
  });
});
