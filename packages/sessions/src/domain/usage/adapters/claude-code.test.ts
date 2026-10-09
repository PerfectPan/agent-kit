import { describe, expect, it } from "vitest";

import { claudeCodeUsage } from "./claude-code.js";

describe("claudeCodeUsage", () => {
  it("adds the cache back into input and derives the total", () => {
    expect(
      claudeCodeUsage({
        input_tokens: 10,
        cache_read_input_tokens: 1,
        cache_creation_input_tokens: 2,
        output_tokens: 4
      })
    ).toEqual({ inputTokens: 13, outputTokens: 4, totalTokens: 17, cacheReadTokens: 1, cacheWriteTokens: 2 });
  });

  it("leaves input and total unknown without input_tokens and keeps the counts that are present", () => {
    expect(claudeCodeUsage({ cache_read_input_tokens: 0, output_tokens: 4 })).toEqual({
      outputTokens: 4,
      cacheReadTokens: 0
    });
  });
});
