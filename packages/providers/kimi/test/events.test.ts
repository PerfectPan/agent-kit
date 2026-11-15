import { type SourcedRecord, type TranscriptEvent } from "@rivus/agent-kit-sessions/spi";
import { describe, expect, it } from "vite-plus/test";

import { createKimiTranslation } from "../src/sessions/events.js";

const record = (value: unknown, line: number): SourcedRecord => ({
  file: "wire.jsonl",
  offset: 0,
  length: 10,
  line,
  value
});

const loop = (event: Record<string, unknown>, line: number): SourcedRecord =>
  record({ type: "context.append_loop_event", event }, line);

const stepEnd = (uuid: string, step: number, line: number): SourcedRecord =>
  loop(
    {
      type: "step.end",
      uuid,
      turnId: "0",
      step,
      finishReason: "end_turn",
      usage: { inputOther: 42, output: 8, inputCacheCreation: 0 }
    },
    line
  );

describe("kimi transcript events", () => {
  it("stamps each step's output with the request that closed it, across adjacent outputs", () => {
    const translation = createKimiTranslation({ retain: true });
    const lines: SourcedRecord[] = [
      record({ type: "metadata", protocol_version: "1.5" }, 1),
      record({ type: "turn.prompt", promptId: "p1", turnId: 0 }, 2),
      loop({ type: "content.part", part: { type: "text", text: "first" } }, 3),
      stepEnd("u1", 1, 4),
      loop({ type: "content.part", part: { type: "text", text: "second" } }, 5),
      stepEnd("u2", 2, 6)
    ];
    for (const [index, line] of lines.entries()) {
      expect(translation.step(line, 1794500959386 + index).ok).toBe(true);
    }
    const events: TranscriptEvent[] = translation.finish({ id: "s" }, []).events;
    expect(events.map((event) => event.kind)).toEqual(["assistant", "request", "assistant", "request"]);
    expect(events.map((event) => event.requestId)).toEqual(["u1", "u1", "u2", "u2"]);
  });
});
