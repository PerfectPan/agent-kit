import { describe, expect, it } from "vite-plus/test";

import { grokCallsOf } from "./calls.js";

function eventsLines(lines: readonly unknown[]): string {
  return lines.map((line) => JSON.stringify(line)).join("\n");
}

describe("grokCallsOf", () => {
  it("joins each turn's loops with its assistant entries", () => {
    const events = eventsLines([
      { ts: "2026-09-13T07:05:53.497Z", type: "turn_started", turn_number: 0, model_id: "grok-4.6" },
      { ts: "2026-09-13T07:05:53.586Z", type: "loop_started", loop_index: 0 },
      { ts: "2026-09-13T07:05:59.382Z", type: "first_token" },
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
    const calls = grokCallsOf(events, history);
    expect(calls?.turns.get(0)).toEqual([
      { ts: Date.parse("2026-09-13T07:05:59.382Z"), model: "grok-4.6-build" },
      { ts: Date.parse("2026-09-13T07:06:25.000Z"), model: "grok-4.7" }
    ]);
    expect(calls?.turns.get(1)).toEqual([{ ts: Date.parse("2026-09-13T07:07:00.100Z"), model: "grok-4.6-build" }]);
  });

  it("keeps the assistant entries when the event log names fewer loops", () => {
    const events = eventsLines([
      { ts: "2026-09-13T07:05:53.497Z", type: "turn_started", turn_number: 0 },
      { ts: "2026-09-13T07:05:53.586Z", type: "loop_started", loop_index: 0 }
    ]);
    const history = eventsLines([
      { type: "user", content: "Hi", prompt_index: 0 },
      { type: "assistant", content: "One", model_id: "a" },
      { type: "assistant", content: "Two", model_id: "b" }
    ]);
    const calls = grokCallsOf(events, history);
    expect(calls?.turns.get(0)).toEqual([
      { ts: Date.parse("2026-09-13T07:05:53.586Z"), model: "a" },
      { ts: undefined, model: "b" }
    ]);
  });

  it("keeps a multi-loop turn the chat history never reached, and drops single-call turns", () => {
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
    const calls = grokCallsOf(events, history);
    expect(calls?.turns.get(0)).toEqual([{ ts: undefined, model: "a" }]);
    expect(calls?.turns.get(3)).toEqual([
      { ts: Date.parse("2026-09-13T07:05:59.382Z") },
      { ts: Date.parse("2026-09-13T07:06:20.000Z") }
    ]);
  });

  it("is undefined when no turn names more than one call", () => {
    const events = eventsLines([
      { ts: "2026-09-13T07:05:53.497Z", type: "turn_started", turn_number: 0 },
      { ts: "2026-09-13T07:05:53.586Z", type: "loop_started", loop_index: 0 }
    ]);
    const history = eventsLines([
      { type: "user", content: "Hi", prompt_index: 0 },
      { type: "assistant", content: "One", model_id: "a" }
    ]);
    expect(grokCallsOf(events, history)).toBeUndefined();
    expect(grokCallsOf(undefined, undefined)).toBeUndefined();
    expect(grokCallsOf("not json\n{", history)).toBeUndefined();
  });
});
