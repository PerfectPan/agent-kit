import type { Usage } from "../value-objects/usage.js";

const COUNTS = [
  "inputTokens",
  "outputTokens",
  "totalTokens",
  "cacheReadTokens",
  "cacheWriteTokens",
  "cacheWrite1hTokens",
  "reasoningTokens"
] as const satisfies readonly (keyof Usage)[];

/**
 * The sum of two usages, count by count, with AI SDK's rule for missing counts: a count absent from both stays
 * absent, and one absent from only one side counts as 0 there. Totals across models mix rates, so price per model
 * before adding.
 */
export function addUsage(left: Usage, right: Usage): Usage {
  const sum: Usage = {};
  for (const key of COUNTS) {
    const a = left[key];
    const b = right[key];
    if (a !== undefined || b !== undefined) {
      sum[key] = (a ?? 0) + (b ?? 0);
    }
  }
  return sum;
}
