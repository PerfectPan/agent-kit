import { compactUsage, type Usage } from "../../domain/usage/index.js";
import { asNumber, asRecord } from "../record-fields.js";

/**
 * The Usage of one model call from a Codex usage object: `token_usage_record.usage` or
 * `token_count.info.last_token_usage`. `input_tokens` already includes cached input, so it is the input count as it is.
 */
export function codexUsage(value: unknown): Usage | undefined {
  const usage = asRecord(value);
  if (!usage) {
    return undefined;
  }
  return compactUsage({
    inputTokens: asNumber(usage.input_tokens),
    outputTokens: asNumber(usage.output_tokens),
    totalTokens: asNumber(usage.total_tokens),
    cacheReadTokens: asNumber(usage.cached_input_tokens),
    cacheWriteTokens: asNumber(usage.cache_write_input_tokens),
    reasoningTokens: asNumber(usage.reasoning_output_tokens)
  });
}

const COUNT_KEYS = [
  "input_tokens",
  "cached_input_tokens",
  "cache_write_input_tokens",
  "output_tokens",
  "reasoning_output_tokens",
  "total_tokens"
] as const;

/**
 * The Usage of the model call between two cumulative `total_token_usage` objects, for a `token_count` that has no
 * `last_token_usage`: each count's increase, never below 0. A count that `total` does not report stays absent.
 */
export function codexUsageDelta(total: unknown, previous: unknown): Usage | undefined {
  const current = asRecord(total);
  if (!current) {
    return undefined;
  }
  const before = asRecord(previous);
  const delta: Record<string, number> = {};
  for (const key of COUNT_KEYS) {
    const value = asNumber(current[key]);
    if (value !== undefined) {
      delta[key] = Math.max(0, value - (asNumber(before?.[key]) ?? 0));
    }
  }
  return codexUsage(delta);
}
