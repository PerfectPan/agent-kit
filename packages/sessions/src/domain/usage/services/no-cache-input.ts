import type { Usage } from "../value-objects/usage.js";

/**
 * Input tokens that were neither read from nor written to a cache: `inputTokens − cacheReadTokens −
 * cacheWriteTokens`, the base-rate input of a price table. A missing cache count is taken as 0; without
 * `inputTokens` the result is unknown.
 */
export function noCacheInputTokens(usage: Usage): number | undefined {
  if (usage.inputTokens === undefined) {
    return undefined;
  }
  return Math.max(0, usage.inputTokens - (usage.cacheReadTokens ?? 0) - (usage.cacheWriteTokens ?? 0));
}
