import { describe, expect, it } from "vitest";

import type { SourcedRecord } from "../../transcript/index.js";
import { claudeCodeUsage, claudeCodeUsageLines } from "./claude-code.js";

describe("claudeCodeUsage", () => {
  it("adds the cache back into input and derives the total", () => {
    expect(
      claudeCodeUsage({
        input_tokens: 10,
        cache_read_input_tokens: 1,
        cache_creation_input_tokens: 2,
        output_tokens: 4
      })
    ).toEqual({
      inputTokens: 13,
      outputTokens: 4,
      totalTokens: 17,
      cacheReadTokens: 1,
      cacheWriteTokens: 2
    });
  });

  it("leaves input and total unknown without input_tokens and keeps the counts that are present", () => {
    expect(claudeCodeUsage({ cache_read_input_tokens: 0, output_tokens: 4 })).toEqual({
      outputTokens: 4,
      cacheReadTokens: 0
    });
  });

  it("leaves a count of an unexpected type out, like an absent one", () => {
    expect(claudeCodeUsage({ input_tokens: "10", output_tokens: null, cache_creation: "flat" })).toBeUndefined();
    expect(
      claudeCodeUsage({
        input_tokens: 10,
        output_tokens: 4,
        cache_creation: { ephemeral_5m_input_tokens: "5" }
      })
    ).toEqual({
      inputTokens: 10,
      outputTokens: 4,
      totalTokens: 14
    });
    expect(claudeCodeUsage("10")).toBeUndefined();
  });
});

describe("claudeCodeUsageLines", () => {
  const file = { path: "s.jsonl", sessionId: "s", mtimeMs: 5, agentLaneId: "sub" };
  const record = (value: unknown): SourcedRecord => ({
    value,
    file: "s.jsonl",
    offset: 0,
    length: 0,
    line: 1
  });

  it("ends a file whose record has no known envelope", () => {
    expect(claudeCodeUsageLines(file).push(record("assistant"))).toEqual({
      ok: false,
      error: { _tag: "UnknownFormatGeneration", agent: "claude-code", file: "s.jsonl", line: 1 }
    });
  });

  it("falls back to the file's lane when a record names its lane in a wrong type", () => {
    const decoder = claudeCodeUsageLines(file);
    expect(
      decoder.push(
        record({
          type: "assistant",
          requestId: "r-1",
          agentId: 7,
          message: { usage: { input_tokens: 1, output_tokens: 2 } }
        })
      )
    ).toEqual({ ok: true, value: [] });
    expect(decoder.end(true)).toEqual([
      {
        agent: "claude-code",
        sessionId: "s",
        granularity: "request",
        timestamp: 5,
        usage: { inputTokens: 1, outputTokens: 2, totalTokens: 3 },
        source: { file: "s.jsonl", offset: 0, length: 0, line: 1 },
        agentLaneId: "sub",
        requestId: "r-1"
      }
    ]);
  });

  it("starts empty from a saved state it cannot read", () => {
    expect(claudeCodeUsageLines(file, { lastTime: "no", lanes: "no" }).save()).toEqual({
      lanes: {}
    });
  });

  it("keeps the lanes and requests it can read and drops the ones it cannot", () => {
    const decoder = claudeCodeUsageLines(file, {
      lastTime: 3,
      lanes: {
        sub: {
          open: [{ key: "k", usage: { inputTokens: 1 }, timestamp: 2, offset: 0, length: 0, line: 1 }],
          reported: ["h"]
        },
        bad: 5,
        worse: {
          open: [
            // No `line`: not a reportable request, so absent while the next one stays.
            { key: "lost", usage: { inputTokens: 1 }, timestamp: 2, offset: 0, length: 0 },
            { key: "kept", usage: {}, timestamp: 4, offset: 1, length: 2, line: 3 }
          ],
          reported: [7]
        }
      }
    });
    expect(decoder.save()).toEqual({
      lastTime: 3,
      lanes: {
        sub: {
          open: [{ key: "k", usage: { inputTokens: 1 }, timestamp: 2, offset: 0, length: 0, line: 1 }],
          reported: ["h"]
        },
        worse: { open: [{ key: "kept", usage: {}, timestamp: 4, offset: 1, length: 2, line: 3 }], reported: [] }
      }
    });
  });
});
