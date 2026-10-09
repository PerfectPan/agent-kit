import { describe, expect, it } from "vitest";

import type { SourcedRecord } from "../../transcript/index.js";
import type { UsageRecord } from "../index.js";
import { piUsageLines } from "./pi.js";

const file = { path: "session.jsonl", sessionId: "session", mtimeMs: 5000 };

const record = (value: unknown, line = 1): SourcedRecord => ({
  file: file.path,
  offset: 0,
  length: 10,
  line,
  value
});

const header = (extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  type: "session",
  id: "s1",
  timestamp: "2026-01-01T00:00:00.000Z",
  ...extra
});

const message = (extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  type: "message",
  id: "e1",
  timestamp: "2026-01-01T00:00:01.000Z",
  message: { role: "assistant", usage: { input: 1, output: 1, totalTokens: 2 } },
  ...extra
});

/** The records a push completes; the decoders under test end no file, so an error would be a defect. */
const pushed = (result: ReturnType<ReturnType<typeof piUsageLines>["push"]>): UsageRecord[] => {
  if (!result.ok) {
    throw new Error(`unexpected ${result.error._tag}`);
  }
  return result.value;
};

describe("pi usage lines", () => {
  it("counts an assistant message with usage, and keeps a logged cost of 0", () => {
    const decoder = piUsageLines(file);
    decoder.push(record(header()));
    expect(pushed(decoder.push(record(message())))).toEqual([
      expect.objectContaining({
        sessionId: "s1",
        requestId: "e1",
        usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 }
      })
    ]);
    expect(
      pushed(
        decoder.push(
          record(message({ id: "e2", message: { role: "assistant", usage: { input: 1, cost: { total: 0 } } } }))
        )
      )
    ).toEqual([expect.objectContaining({ requestId: "e2", costUsd: 0, costSource: "agent" })]);
  });

  it("leaves a record out when it is not an object, is no session header, or is no assistant message", () => {
    const decoder = piUsageLines(file);
    for (const value of [[], "session", 5, null, { type: "other" }, message({ message: { role: "user" } })]) {
      expect(pushed(decoder.push(record(value)))).toEqual([]);
    }
  });

  it("reads a field of an unexpected type as absent", () => {
    const decoder = piUsageLines(file);
    decoder.push(record(header({ id: 5 })));
    expect(pushed(decoder.push(record(message())))).toEqual([expect.objectContaining({ sessionId: "session" })]);
    expect(
      pushed(
        decoder.push(
          record(
            message({ id: "e2", message: { role: "assistant", usage: { input: "1", output: 2, totalTokens: 2 } } })
          )
        )
      )
    ).toEqual([expect.objectContaining({ usage: { outputTokens: 2, totalTokens: 2 } })]);
    expect(
      pushed(decoder.push(record(message({ id: "e3", message: { role: "assistant", usage: "1 input" } }))))
    ).toEqual([]);
    const noCost = pushed(
      decoder.push(
        record(message({ id: "e4", message: { role: "assistant", usage: { input: 1, cost: { total: "0" } } } }))
      )
    );
    expect(noCost[0]).toMatchObject({ requestId: "e4" });
    expect(noCost[0]).not.toHaveProperty("costUsd");
  });

  it("skips the parent's copied entries at the start of a fork, named by a string parentSession only", () => {
    const forked = piUsageLines(file);
    forked.push(record(header({ id: "s2", parentSession: "s1" })));
    expect(pushed(forked.push(record(message({ timestamp: "2025-12-31T00:00:00.000Z" }))))).toEqual([]);
    expect(pushed(forked.push(record(message({ id: "e2" }))))).toHaveLength(1);
    const plain = piUsageLines(file);
    plain.push(record(header({ id: "s3", parentSession: 5 })));
    expect(pushed(plain.push(record(message({ timestamp: "2025-12-31T00:00:00.000Z" }))))).toHaveLength(1);
  });

  it("continues from a saved cursor state, reading a field of an unexpected type as absent", () => {
    const decoder = piUsageLines(file, { lastTime: "no", forkTime: Date.parse("2026-01-01T00:00:00.000Z") });
    expect(pushed(decoder.push(record(message({ timestamp: "2025-12-31T00:00:00.000Z" }))))).toEqual([]);
  });
});
