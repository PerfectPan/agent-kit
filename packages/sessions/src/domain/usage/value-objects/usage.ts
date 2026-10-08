/**
 * Token counts of one model request or an aggregate, in the OTel GenAI and AI SDK convention: `inputTokens`
 * includes cache reads and writes, `outputTokens` includes reasoning, and the other counts are subsets. A count the
 * log does not report is absent, never 0.
 */
export interface Usage {
  /** gen_ai.usage.input_tokens */
  inputTokens?: number;
  /** gen_ai.usage.output_tokens */
  outputTokens?: number;
  totalTokens?: number;
  /** gen_ai.usage.cache_read.input_tokens; part of `inputTokens`. */
  cacheReadTokens?: number;
  /** gen_ai.usage.cache_write.input_tokens; part of `inputTokens`. */
  cacheWriteTokens?: number;
  /** Anthropic's one-hour ephemeral cache writes; part of `cacheWriteTokens`. */
  cacheWrite1hTokens?: number;
  /** gen_ai.usage.reasoning.output_tokens; part of `outputTokens`. */
  reasoningTokens?: number;
}

const USAGE_KEYS = [
  "inputTokens",
  "outputTokens",
  "totalTokens",
  "cacheReadTokens",
  "cacheWriteTokens",
  "cacheWrite1hTokens",
  "reasoningTokens"
] as const satisfies readonly (keyof Usage)[];

/**
 * A `Usage` with only the counts that are present, or `undefined` when none is. `totalTokens` is derived from input
 * and output when the agent does not report it and both are known.
 */
export function compactUsage(counts: Usage): Usage | undefined {
  const usage: Usage = {};
  for (const key of USAGE_KEYS) {
    const value = counts[key];
    if (value !== undefined) {
      usage[key] = value;
    }
  }
  if (usage.totalTokens === undefined && usage.inputTokens !== undefined && usage.outputTokens !== undefined) {
    usage.totalTokens = usage.inputTokens + usage.outputTokens;
  }
  return Object.keys(usage).length > 0 ? usage : undefined;
}
