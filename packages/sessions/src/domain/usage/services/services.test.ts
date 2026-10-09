import { describe, expect, it } from "vite-plus/test";

import { addUsage } from "./add-usage.js";
import { noCacheInputTokens } from "./no-cache-input.js";
import { toAiSdkUsage } from "./to-ai-sdk-usage.js";
import { toOtelAttributes } from "./to-otel-attributes.js";

const usage = {
  inputTokens: 115,
  outputTokens: 20,
  totalTokens: 135,
  cacheReadTokens: 100,
  cacheWriteTokens: 5,
  cacheWrite1hTokens: 3,
  reasoningTokens: 4
};

describe("usage conversions", () => {
  it("takes the cache out of the input for pricing, and knows nothing without input", () => {
    expect(noCacheInputTokens(usage)).toBe(10);
    expect(noCacheInputTokens({ inputTokens: 7 })).toBe(7);
    expect(noCacheInputTokens({ cacheReadTokens: 3 })).toBeUndefined();
  });

  it("adds counts, keeping a count that both sides lack absent", () => {
    expect(addUsage({ inputTokens: 1, cacheReadTokens: 1 }, { inputTokens: 2, outputTokens: 3 })).toEqual({
      inputTokens: 3,
      outputTokens: 3,
      cacheReadTokens: 1
    });
  });

  it("converts to AI SDK's LanguageModelUsage, with text output only when reasoning is known", () => {
    expect(toAiSdkUsage(usage)).toEqual({
      inputTokens: 115,
      inputTokenDetails: { noCacheTokens: 10, cacheReadTokens: 100, cacheWriteTokens: 5 },
      outputTokens: 20,
      outputTokenDetails: { textTokens: 16, reasoningTokens: 4 },
      totalTokens: 135
    });
    expect(toAiSdkUsage({ outputTokens: 5 }).outputTokenDetails).toEqual({
      textTokens: undefined,
      reasoningTokens: undefined
    });
  });

  it("names OTel GenAI attributes, with the cache write key the caller picks", () => {
    expect(toOtelAttributes(usage)).toEqual({
      "gen_ai.usage.input_tokens": 115,
      "gen_ai.usage.output_tokens": 20,
      "gen_ai.usage.cache_read.input_tokens": 100,
      "gen_ai.usage.cache_creation.input_tokens": 5,
      "gen_ai.usage.reasoning.output_tokens": 4
    });
    expect(toOtelAttributes({ cacheWriteTokens: 2 }, { cacheWriteKey: "cache_write" })).toEqual({
      "gen_ai.usage.cache_write.input_tokens": 2
    });
  });
});
