import { compactUsage, type Usage } from "../../domain/usage/index.js";
import { asNumber, asRecord } from "../record-fields.js";

/** One model's share of a turn summary. `modelCalls` is how many model calls this share covers. */
export interface GrokModelUsage {
  usage: Usage;
  modelCalls?: number;
}

/**
 * Usage of a `turn_completed.usage` object, or of one `modelUsage` entry. Grok's `inputTokens` already includes
 * cached input (`cachedReadTokens` ≤ `inputTokens`), so cache counts stay subsets and are not added again.
 */
export function grokUsage(value: unknown): Usage | undefined {
  const raw = asRecord(value);
  if (!raw) {
    return undefined;
  }
  return compactUsage({
    inputTokens: asNumber(raw.inputTokens),
    outputTokens: asNumber(raw.outputTokens),
    totalTokens: asNumber(raw.totalTokens),
    cacheReadTokens: asNumber(raw.cachedReadTokens),
    cacheWriteTokens: asNumber(raw.cacheCreationTokens),
    reasoningTokens: asNumber(raw.reasoningTokens)
  });
}

/** Per-model detail of a turn summary. Entries with no token counts are left out. */
export function grokUsageByModel(value: unknown): Record<string, GrokModelUsage> | undefined {
  const models = asRecord(value);
  if (!models) {
    return undefined;
  }
  const out: Record<string, GrokModelUsage> = {};
  for (const [model, raw] of Object.entries(models)) {
    const usage = grokUsage(raw);
    if (!usage) {
      continue;
    }
    const detail: GrokModelUsage = { usage };
    const calls = asNumber(asRecord(raw)?.modelCalls);
    if (calls !== undefined) {
      detail.modelCalls = calls;
    }
    out[model] = detail;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}
