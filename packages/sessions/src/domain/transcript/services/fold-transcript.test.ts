import { describe, expect, it } from "vite-plus/test";

import { sessionPrompts } from "../policies/turns.js";
import type { TranscriptEvent } from "../value-objects/transcript-event.js";
import type { Transcript } from "../value-objects/transcript.js";
import { foldTranscript } from "./fold-transcript.js";

const source = { file: "fixture.jsonl", offset: 0, length: 1, line: 1 };

function event(partial: Partial<TranscriptEvent> & Pick<TranscriptEvent, "id" | "kind">): TranscriptEvent {
  return { seq: 0, ts: 1, payload: {}, source, ...partial };
}

function transcript(partial: Partial<Transcript> & Pick<Transcript, "events" | "capabilities">): Transcript {
  return { agent: "demo", session: { id: "s" }, agents: [{ id: "main" }], skipped: [], ...partial };
}

describe("foldTranscript", () => {
  it("leaves the numbers of unlisted capabilities absent", () => {
    const summary = foldTranscript(
      transcript({
        capabilities: [],
        events: [
          event({ id: "u", kind: "user" }),
          event({ id: "r", kind: "request", payload: { usage: { inputTokens: 3, outputTokens: 1 }, durationMs: 5 } }),
          event({ id: "t", kind: "tool_result", payload: { callId: "c", isError: true } })
        ]
      })
    );
    expect(summary).toEqual({ turns: 1, failedTools: 1 });
  });

  it("counts a turn only for a real prompt record on the main lane", () => {
    const summary = foldTranscript(
      transcript({
        capabilities: [],
        agents: [{ id: "main" }, { id: "child", parentId: "main" }],
        events: [
          event({ id: "u", kind: "user" }),
          event({ id: "m", kind: "user", payload: { meta: true } }),
          event({ id: "c", kind: "user", payload: { compactSummary: true } }),
          event({ id: "k", kind: "user", payload: { command: true } }),
          event({ id: "i", kind: "user", payload: { injected: true } }),
          event({ id: "s", kind: "user", agentId: "child" }),
          event({ id: "u-block", kind: "user" }),
          event({ id: "n", kind: "user", payload: { continued: true }, source: { ...source, line: 3 } }),
          event({ id: "v", kind: "user", source: { ...source, line: 2 } })
        ]
      })
    );
    expect(summary.turns).toBe(2);
  });

  it("sums turn durations, and request durations only when no turn has one", () => {
    const request = event({ id: "r", kind: "request", payload: { durationMs: 7 } });
    const turn = event({ id: "t", kind: "system", payload: { type: "turn_duration", durationMs: 40 } });
    expect(foldTranscript(transcript({ capabilities: ["durations"], events: [request, turn] })).durationMs).toBe(40);
    expect(foldTranscript(transcript({ capabilities: ["durations"], events: [request] })).durationMs).toBe(7);
  });

  it("sums listed usage, keeps a missing count absent and downsamples the context shape", () => {
    const events = Array.from({ length: 121 }, (_, index) =>
      event({ id: `r${index}`, kind: "request", payload: { usage: { inputTokens: index } } })
    );
    const summary = foldTranscript(transcript({ capabilities: ["requests", "usage"], events }));
    expect(summary.requests).toBe(121);
    expect(summary.inputTokens).toBe((120 * 121) / 2);
    expect(summary.outputTokens).toBeUndefined();
    expect(summary.contextShape).toHaveLength(120);
    expect(summary.contextShape?.[0]).toBe(0);
    expect(summary.contextShape?.[119]).toBe(120);
  });
});

describe("sessionPrompts", () => {
  it("takes one prompt per record, the first non-empty text of its events", () => {
    const summary = transcript({
      capabilities: [],
      events: [
        event({ id: "u1", kind: "user", payload: { text: "first" } }),
        event({ id: "u2", kind: "user", payload: { text: "" }, source: { ...source, line: 2 } }),
        event({ id: "u2b", kind: "user", payload: { text: "second" }, source: { ...source, line: 2 } }),
        event({ id: "i", kind: "user", payload: { injected: true, text: "not a prompt" } }),
        event({ id: "s", kind: "user", agentId: "side", payload: { text: "side lane" } })
      ]
    });
    expect(sessionPrompts(summary, { limit: 10, maxChars: 100 })).toEqual([{ text: "first" }, { text: "second" }]);
  });

  it("caps the count and each text, and keeps a promptless list empty", () => {
    const events = Array.from({ length: 5 }, (_, index) =>
      event({
        id: `u${index}`,
        kind: "user",
        payload: { text: `prompt ${index}` },
        source: { ...source, line: index + 1 }
      })
    );
    expect(sessionPrompts(transcript({ capabilities: [], events }), { limit: 2, maxChars: 8 })).toEqual([
      { text: "prompt 0" },
      { text: "prompt 1" }
    ]);
    expect(sessionPrompts(transcript({ capabilities: [], events }), { limit: 0, maxChars: 8 })).toEqual([]);
  });
});
