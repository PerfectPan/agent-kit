import { describe, expect, it } from "vitest";

import type { SourcedRecord } from "../../transcript/index.js";
import type { UsageRecord } from "../index.js";
import { geminiCliLegacyUsage, geminiCliUsageLines } from "./gemini-cli.js";

const file = { path: "chat.jsonl", sessionId: "chat", mtimeMs: 1000 };
const TIME = Date.parse("2026-01-01T00:00:01.000Z");

const record = (value: unknown, line = 1): SourcedRecord => ({
  file: file.path,
  offset: 0,
  length: 10,
  line,
  value
});

/** A `gemini` message record with token counts. */
const gemini = (id: string, tokens: unknown, extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  id,
  type: "gemini",
  timestamp: "2026-01-01T00:00:01.000Z",
  tokens,
  ...extra
});

/** The records a push completes; the decoders under test end no file, so an error would be a defect. */
const pushed = (result: ReturnType<ReturnType<typeof geminiCliUsageLines>["push"]>): UsageRecord[] => {
  if (!result.ok) {
    throw new Error(`unexpected ${result.error._tag}`);
  }
  return result.value;
};

describe("gemini-cli usage lines", () => {
  it("counts a gemini message's tokens once, adding tool and thoughts back", () => {
    const decoder = geminiCliUsageLines(file);
    expect(
      pushed(decoder.push(record(gemini("m1", { input: 100, output: 20, thoughts: 4, tool: 5, total: 129 }))))
    ).toEqual([
      expect.objectContaining({
        requestId: "m1",
        usage: { inputTokens: 105, outputTokens: 24, totalTokens: 129, reasoningTokens: 4 }
      })
    ]);
    expect(pushed(decoder.push(record(gemini("m1", { input: 100, output: 20 }))))).toEqual([]);
  });

  it("leaves a record out when it is not an object, has no usable id, or carries a $patch", () => {
    const decoder = geminiCliUsageLines(file);
    for (const value of [
      [],
      "gemini",
      5,
      null,
      { type: "gemini" },
      { id: 5, type: "gemini" },
      { id: "m1", $patch: {} }
    ]) {
      expect(pushed(decoder.push(record(value)))).toEqual([]);
    }
  });

  it("reads a field of an unexpected type as absent: the other token counts still count", () => {
    const decoder = geminiCliUsageLines(file);
    expect(pushed(decoder.push(record(gemini("m1", { input: "100", output: 20, total: 20 }))))).toEqual([
      expect.objectContaining({ usage: { outputTokens: 20, totalTokens: 20 } })
    ]);
  });

  it("adopts the record's session id only behind a string project hash", () => {
    const adopt = geminiCliUsageLines(file);
    adopt.push(record(gemini("m1", { input: 1 }, { projectHash: "p", sessionId: "s1" })));
    expect(pushed(adopt.push(record(gemini("m2", { input: 1 }))))).toEqual([
      expect.objectContaining({ sessionId: "s1" })
    ]);
    const keep = geminiCliUsageLines(file);
    keep.push(record(gemini("m1", { input: 1 }, { projectHash: 5, sessionId: "s1" })));
    expect(pushed(keep.push(record(gemini("m2", { input: 1 }))))).toEqual([
      expect.objectContaining({ sessionId: "chat" })
    ]);
  });

  it("continues from a saved cursor state, reading a field of an unexpected type as absent", () => {
    const decoder = geminiCliUsageLines(file, {
      lastId: "m1",
      lastReported: true,
      lastTime: "2026-01-01T00:00:01.000Z"
    });
    expect(pushed(decoder.push(record(gemini("m1", { input: 1 }))))).toEqual([]);
    expect(pushed(decoder.push(record(gemini("m2", { input: 1 }))))).toHaveLength(1);
    const fresh = geminiCliUsageLines(file, { lastId: 5 });
    expect(pushed(fresh.push(record(gemini("m1", { input: 1 }))))).toHaveLength(1);
  });
});

describe("gemini-cli legacy chat usage", () => {
  it("counts each gemini message once by id", () => {
    const source = { file: "chat.json", offset: 0, length: 100, line: 1 };
    const chat = {
      sessionId: "s1",
      messages: [
        gemini("m1", { input: 1, output: 1 }),
        gemini("m1", { input: 2, output: 2 }),
        { type: "user" },
        gemini("m2", { input: 3, output: 3 })
      ]
    };
    expect(geminiCliLegacyUsage(chat, file, source)).toEqual([
      expect.objectContaining({ requestId: "m1", sessionId: "s1", timestamp: TIME }),
      expect.objectContaining({ requestId: "m2" })
    ]);
  });

  it("reads a field of an unexpected type as absent", () => {
    const source = { file: "chat.json", offset: 0, length: 100, line: 1 };
    expect(geminiCliLegacyUsage({ messages: {} }, file, source)).toEqual([]);
    expect(
      geminiCliLegacyUsage({ sessionId: 5, messages: ["no", gemini("m1", { input: 1, output: 1 })] }, file, source)
    ).toEqual([expect.objectContaining({ sessionId: "chat" })]);
  });
});
