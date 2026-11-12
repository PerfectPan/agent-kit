import { describe, expect, it } from "vite-plus/test";

import { grokCallsOf } from "./calls.js";

async function* eventsLines(lines: readonly unknown[]): AsyncGenerator<{ value: unknown }> {
  for (const value of lines) {
    yield { value };
  }
}

describe("grokCallsOf", () => {
  it("joins each turn's loops with its assistant entries", async () => {
    const events = eventsLines([
      { ts: "2026-09-13T07:05:53.497Z", type: "turn_started", turn_number: 0, model_id: "grok-4.6" },
      { ts: "2026-09-13T07:05:53.586Z", type: "loop_started", loop_index: 0 },
      { ts: "2026-09-13T07:05:59.382Z", type: "first_token" },
      { ts: "2026-09-13T07:06:00.000Z", type: "tool_started", tool_name: "read_file" },
      { ts: "2026-09-13T07:06:01.000Z", type: "tool_completed", tool_name: "read_file", tool_call_id: "c1" },
      { ts: "2026-09-13T07:06:20.000Z", type: "loop_started", loop_index: 1 },
      { ts: "2026-09-13T07:06:25.000Z", type: "first_token" },
      { ts: "2026-09-13T07:07:00.000Z", type: "turn_started", turn_number: 1, model_id: "grok-4.6" },
      { ts: "2026-09-13T07:07:00.100Z", type: "loop_started", loop_index: 0 }
    ]);
    const history = eventsLines([
      { type: "user", content: "Hi", prompt_index: 0 },
      { type: "assistant", content: "One", model_id: "grok-4.6-build" },
      { type: "assistant", content: "Two", model_id: "grok-4.7" },
      { type: "user", content: "More", prompt_index: 1 },
      { type: "assistant", content: "Three", model_id: "grok-4.6-build" }
    ]);
    const calls = await grokCallsOf(events, history);
    expect(calls?.turns.get(0)).toEqual([
      { ts: Date.parse("2026-09-13T07:05:59.382Z"), model: "grok-4.6-build", toolCallIds: ["c1"] },
      { ts: Date.parse("2026-09-13T07:06:25.000Z"), model: "grok-4.7", toolCallIds: [] }
    ]);
    expect(calls?.turns.get(1)).toEqual([
      { ts: Date.parse("2026-09-13T07:07:00.100Z"), model: "grok-4.6-build", toolCallIds: [] }
    ]);
  });

  it("keeps the assistant entries when the event log names fewer loops", async () => {
    const events = eventsLines([
      { ts: "2026-09-13T07:05:53.497Z", type: "turn_started", turn_number: 0 },
      { ts: "2026-09-13T07:05:53.586Z", type: "loop_started", loop_index: 0 }
    ]);
    const history = eventsLines([
      { type: "user", content: "Hi", prompt_index: 0 },
      { type: "assistant", content: "One", model_id: "a" },
      { type: "assistant", content: "Two", model_id: "b" }
    ]);
    const calls = await grokCallsOf(events, history);
    expect(calls?.turns.get(0)).toEqual([
      { ts: Date.parse("2026-09-13T07:05:53.586Z"), model: "a", toolCallIds: [] },
      { ts: undefined, model: "b", toolCallIds: undefined }
    ]);
  });

  it("keeps a multi-loop turn the chat history never reached, and drops single-call turns", async () => {
    const events = eventsLines([
      { ts: "2026-09-13T07:05:53.497Z", type: "turn_started", turn_number: 3 },
      { ts: "2026-09-13T07:05:53.586Z", type: "loop_started", loop_index: 0 },
      { ts: "2026-09-13T07:05:59.382Z", type: "first_token" },
      { ts: "2026-09-13T07:06:20.000Z", type: "loop_started", loop_index: 1 }
    ]);
    const history = eventsLines([
      { type: "user", content: "Hi", prompt_index: 0 },
      { type: "assistant", content: "One", model_id: "a" }
    ]);
    const calls = await grokCallsOf(events, history);
    expect(calls?.turns.get(0)).toEqual([{ ts: undefined, model: "a" }]);
    expect(calls?.turns.get(3)).toEqual([
      { ts: Date.parse("2026-09-13T07:05:59.382Z"), toolCallIds: [] },
      { ts: Date.parse("2026-09-13T07:06:20.000Z"), toolCallIds: [] }
    ]);
  });

  it("keeps a turn going past an unnumbered user entry, and falls back to the loops of a prompt with no answer", async () => {
    const events = eventsLines([
      { ts: "2026-09-13T07:05:53.497Z", type: "turn_started", turn_number: 0 },
      { ts: "2026-09-13T07:05:53.586Z", type: "loop_started", loop_index: 0 },
      { ts: "2026-09-13T07:05:55.000Z", type: "loop_started", loop_index: 1 },
      { ts: "2026-09-13T07:06:00.000Z", type: "turn_started", turn_number: 1 },
      { ts: "2026-09-13T07:06:00.100Z", type: "loop_started", loop_index: 0 },
      { ts: "2026-09-13T07:06:02.000Z", type: "loop_started", loop_index: 1 }
    ]);
    const history = eventsLines([
      { type: "user", content: "Hi", prompt_index: 0 },
      { type: "assistant", content: "One", model_id: "a" },
      { type: "user", content: "<system-reminder>" },
      { type: "assistant", content: "Two", model_id: "b" },
      { type: "user", content: "More", prompt_index: 1 }
    ]);
    const calls = await grokCallsOf(events, history);
    expect(calls?.turns.get(0)?.map((call) => call.model)).toEqual(["a", "b"]);
    expect(calls?.turns.get(1)).toEqual([
      { ts: Date.parse("2026-09-13T07:06:00.100Z"), model: undefined, toolCallIds: [] },
      { ts: Date.parse("2026-09-13T07:06:02.000Z"), model: undefined, toolCallIds: [] }
    ]);
  });

  it("is undefined when no turn names more than one call", async () => {
    const events = eventsLines([
      { ts: "2026-09-13T07:05:53.497Z", type: "turn_started", turn_number: 0 },
      { ts: "2026-09-13T07:05:53.586Z", type: "loop_started", loop_index: 0 }
    ]);
    const history = eventsLines([
      { type: "user", content: "Hi", prompt_index: 0 },
      { type: "assistant", content: "One", model_id: "a" }
    ]);
    expect(await grokCallsOf(events, history)).toBeUndefined();
    expect(await grokCallsOf(eventsLines([]), eventsLines([]))).toBeUndefined();
    // Records of another shape join nothing.
    expect(
      await grokCallsOf(
        eventsLines(["not an object", { type: "turn_started", turn_number: "0" }, { type: "loop_started" }]),
        eventsLines([null, { type: "user", prompt_index: "0" }, { type: "assistant", model_id: "a" }])
      )
    ).toBeUndefined();
  });
});
