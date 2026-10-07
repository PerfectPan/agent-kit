import { compactUsage, type Usage } from "../../domain/usage/index.js";
import { asNumber, asRecord } from "../record-fields.js";

/**
 * The Usage of one assistant message's `usage` object. Claude Code reports `input_tokens` without the cache, so
 * cache reads and writes are added back; without `input_tokens` the total input is unknown, and only the cache counts
 * that are present remain. When the log has the `cache_creation` breakdown by TTL, it is the cache
 * write count: the flat `cache_creation_input_tokens` can be 0 while the one-hour bucket is not.
 */
export function claudeCodeUsage(value: unknown): Usage | undefined {
  const usage = asRecord(value);
  if (!usage) {
    return undefined;
  }
  const input = asNumber(usage.input_tokens);
  const cacheRead = asNumber(usage.cache_read_input_tokens);
  const byTtl = asRecord(usage.cache_creation);
  const write5m = asNumber(byTtl?.ephemeral_5m_input_tokens);
  const write1h = asNumber(byTtl?.ephemeral_1h_input_tokens);
  const cacheWrite =
    write5m !== undefined || write1h !== undefined
      ? (write5m ?? 0) + (write1h ?? 0)
      : asNumber(usage.cache_creation_input_tokens);
  return compactUsage({
    inputTokens: input === undefined ? undefined : input + (cacheRead ?? 0) + (cacheWrite ?? 0),
    outputTokens: asNumber(usage.output_tokens),
    cacheReadTokens: cacheRead,
    cacheWriteTokens: cacheWrite,
    cacheWrite1hTokens: write1h,
    reasoningTokens: asNumber(asRecord(usage.output_tokens_details)?.thinking_tokens)
  });
}
