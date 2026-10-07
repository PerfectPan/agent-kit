import type { Usage } from "../value-objects/usage.js";
import { noCacheInputTokens } from "./no-cache-input.js";

/** The shape of AI SDK 7's `LanguageModelUsage`, without its provider-specific `raw` field. */
export interface AiSdkUsage {
  inputTokens: number | undefined;
  inputTokenDetails: {
    noCacheTokens: number | undefined;
    cacheReadTokens: number | undefined;
    cacheWriteTokens: number | undefined;
  };
  outputTokens: number | undefined;
  outputTokenDetails: {
    textTokens: number | undefined;
    reasoningTokens: number | undefined;
  };
  totalTokens: number | undefined;
}

/**
 * The usage as AI SDK's `LanguageModelUsage`. Both follow the same convention, so only the derived counts are
 * computed: no-cache input, and text output when the reasoning count is known.
 */
export function toAiSdkUsage(usage: Usage): AiSdkUsage {
  const { outputTokens, reasoningTokens } = usage;
  return {
    inputTokens: usage.inputTokens,
    inputTokenDetails: {
      noCacheTokens: noCacheInputTokens(usage),
      cacheReadTokens: usage.cacheReadTokens,
      cacheWriteTokens: usage.cacheWriteTokens
    },
    outputTokens,
    outputTokenDetails: {
      textTokens:
        outputTokens === undefined || reasoningTokens === undefined
          ? undefined
          : Math.max(0, outputTokens - reasoningTokens),
      reasoningTokens
    },
    totalTokens: usage.totalTokens
  };
}
