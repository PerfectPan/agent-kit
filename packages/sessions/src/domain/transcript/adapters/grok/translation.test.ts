import { describe, expect, it } from "vite-plus/test";

import type { SourcedRecord } from "../../index.js";
import { MAIN_LANE_ID } from "../../index.js";
import type { GrokSubagentMeta } from "../../../session/adapters/grok/layout.js";
import { applyGrokSubagents, createGrokTranslation } from "./translation.js";

const record = (update: Record<string, unknown>, line: number): SourcedRecord => ({
  value: { timestamp: 1767225600 + line, params: { update } },
  file: "updates.jsonl",
  line,
  offset: 0,
  length: 1
});

const steps = (updates: Record<string, unknown>[], retain: boolean) => {
  const translation = createGrokTranslation({ retain });
  const parts = [];
  for (const [index, update] of updates.entries()) {
    const step = translation.step(record(update, index + 1), 1767225600 + index);
    if (!step.ok) {
      throw new Error("unknown generation");
    }
    parts.push(step.parts);
  }
  return { translation, parts };
};

const prompt = (text: string, promptIndex = 0): Record<string, unknown> => ({
  sessionUpdate: "user_message_chunk",
  content: { type: "text", text },
  _meta: { promptIndex, modelId: "m" }
});

describe("createGrokTranslation tool results", () => {
  it("reads the failure from the last done row, and only a done row writes it", () => {
    // A later non-done status rewrites nothing, and a completed rewrite clears the failure again.
    const { translation } = steps(
      [
        { sessionUpdate: "tool_call", toolCallId: "c1", title: "shell" },
        { sessionUpdate: "tool_call_update", toolCallId: "c1", status: "failed", rawOutput: "1 failed" },
        { sessionUpdate: "tool_call_update", toolCallId: "c1", title: "shell (npm)" },
        { sessionUpdate: "tool_call_update", toolCallId: "c1", status: "running" },
        { sessionUpdate: "tool_call_update", toolCallId: "c1", status: "completed", rawOutput: "all green" }
      ],
      false
    );
    expect([...translation.toolResults]).toEqual([["c1", false]]);
  });

  it("keeps the failure when a non-done row follows the done row, and a tool_call row touches nothing", () => {
    const { translation } = steps(
      [
        { sessionUpdate: "tool_call", toolCallId: "c1", title: "shell" },
        { sessionUpdate: "tool_call_update", toolCallId: "c1", status: "error", rawOutput: "boom" },
        { sessionUpdate: "tool_call_update", toolCallId: "c1", status: "pending" },
        { sessionUpdate: "tool_call", toolCallId: "c1", title: "shell again" }
      ],
      false
    );
    expect([...translation.toolResults]).toEqual([["c1", true]]);
  });

  it("merges the rows of an empty call id into one call", () => {
    const { translation } = steps(
      [
        { sessionUpdate: "tool_call", toolCallId: "", title: "ghost" },
        { sessionUpdate: "tool_call_update", toolCallId: "", status: "error" }
      ],
      false
    );
    expect([...translation.toolResults]).toEqual([["", true]]);
  });

  it("reads the same final failures with and without retain", () => {
    const updates = [
      prompt("Go"),
      { sessionUpdate: "tool_call", toolCallId: "c1", title: "shell" },
      { sessionUpdate: "tool_call_update", toolCallId: "c1", status: "failed" },
      { sessionUpdate: "tool_call_update", toolCallId: "c1", status: "completed" },
      { sessionUpdate: "tool_call_update", toolCallId: "c2", status: "error" }
    ];
    const bounded = steps(updates, false).translation;
    const retained = steps(updates, true).translation;
    expect([...bounded.toolResults]).toEqual([...retained.toolResults]);
    expect([...retained.toolResults]).toEqual([
      ["c1", false],
      ["c2", true]
    ]);
  });
});

describe("createGrokTranslation steps", () => {
  it("returns light parts without retain and the emitted events with it", () => {
    const updates = [
      prompt("Hi"),
      { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "Hey" } },
      { sessionUpdate: "turn_completed", prompt_id: "p-1", elapsed_ms: 10, usage: { inputTokens: 5, outputTokens: 1 } }
    ];
    const bounded = steps(updates, false);
    expect(bounded.parts.flat().map((part) => part.id)).toEqual([undefined, undefined, undefined, undefined]);
    const request = bounded.parts[2]!.find((part) => part.kind === "request");
    expect(request?.payload).toEqual({
      granularity: "turn",
      model: "m",
      usage: { inputTokens: 5, outputTokens: 1, totalTokens: 6 }
    });
    const retained = steps(updates, true);
    // The request is placed before the turn's first output.
    expect(retained.translation.events.map((event) => event.kind)).toEqual(["user", "request", "assistant", "system"]);
    expect(retained.translation.events.find((event) => event.kind === "request")?.payload).toEqual(request?.payload);
  });

  it("keeps turn state across steps: a continued prompt and the model forgotten at the turn's end", () => {
    const bounded = steps(
      [
        prompt("one", 0),
        prompt("two", 0),
        prompt("three", 1),
        { sessionUpdate: "turn_completed", prompt_id: "p-1" },
        { sessionUpdate: "user_message_chunk", content: { type: "text", text: "four" }, _meta: { promptIndex: 2 } },
        { sessionUpdate: "turn_completed", prompt_id: "p-2", usage: { inputTokens: 1, outputTokens: 1 } }
      ],
      false
    );
    const users = bounded.parts.flat().filter((part) => part.kind === "user");
    expect(users.map((part) => part.payload)).toEqual([
      { text: "one" },
      { continued: true, text: "two" },
      { text: "three" },
      { text: "four" }
    ]);
    // The model is forgotten at the first turn_completed, so the second request names no model.
    const requests = bounded.parts.flat().filter((part) => part.kind === "request");
    expect(requests.map((part) => part.payload.model)).toEqual(["m", undefined]);
  });

  it("names a lane per spawned subagent, without titles in the bounded pass", () => {
    const updates = [
      { sessionUpdate: "subagent_spawned", subagent_id: "w", description: "Dig" },
      { sessionUpdate: "subagent_spawned", subagent_id: "w", description: "Again" },
      { sessionUpdate: "subagent_finished", subagent_id: "w" }
    ];
    expect(steps(updates, false).translation.agents).toEqual([
      { id: MAIN_LANE_ID },
      { id: "w", parentId: MAIN_LANE_ID }
    ]);
    const retained = steps(updates, true).translation;
    expect(retained.agents[1]).toMatchObject({ id: "w", parentId: MAIN_LANE_ID, title: "Dig" });
    expect(retained.agents[1]?.spawnEventId).toBeTypeOf("string");
  });
});

describe("applyGrokSubagents", () => {
  it("adds one lane per directory under the id its meta names, and fills only missing titles", () => {
    const agents = [{ id: MAIN_LANE_ID }, { id: "w", parentId: MAIN_LANE_ID, title: "From the log" }];
    applyGrokSubagents(
      agents,
      new Map<string, GrokSubagentMeta>([
        ["run-9", { id: "w-actual", title: "From meta" }],
        ["byname", { title: "Named by dir" }],
        ["w", { title: "Ignored" }],
        ["empty", {}]
      ])
    );
    expect(agents).toEqual([
      { id: MAIN_LANE_ID },
      { id: "w", parentId: MAIN_LANE_ID, title: "From the log" },
      { id: "w-actual", parentId: MAIN_LANE_ID, title: "From meta" },
      { id: "byname", parentId: MAIN_LANE_ID, title: "Named by dir" },
      { id: "empty", parentId: MAIN_LANE_ID }
    ]);
  });

  it("leaves the lanes alone without a meta map", () => {
    const agents = [{ id: MAIN_LANE_ID }];
    applyGrokSubagents(agents, undefined);
    expect(agents).toEqual([{ id: MAIN_LANE_ID }]);
  });
});
