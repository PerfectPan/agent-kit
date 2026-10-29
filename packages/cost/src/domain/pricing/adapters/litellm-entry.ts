import type { Price, PriceTier } from "../value-objects/price.js";

/**
 * One `*_above_<N>k_tokens` tier of LiteLLM's list that the kit reads, in USD per token under LiteLLM's field
 * names, with the threshold factored out. A field is here only when LiteLLM lists it under the tier.
 */
export interface LiteLLMLongContext {
  /** The threshold, from the `<N>k` of the field names: 272000 for `_above_272k_tokens`. */
  readonly above_tokens: number;
  readonly input_cost_per_token?: number | undefined;
  readonly output_cost_per_token?: number | undefined;
  readonly cache_read_input_token_cost?: number | undefined;
  readonly cache_creation_input_token_cost?: number | undefined;
  readonly cache_creation_input_token_cost_above_1hr?: number | undefined;
}

/**
 * The fields of one entry of LiteLLM's list that the kit reads, in USD per token under LiteLLM's field names. A
 * model's long-context tier is kept under `long_context`; the batch, flex, priority, ultrafast and decisions
 * variants of a price, and the cache-write tiers of another lifetime (`_above_12hr_…`), are not read.
 */
export interface LiteLLMEntry {
  readonly input_cost_per_token: number;
  readonly output_cost_per_token: number;
  readonly cache_read_input_token_cost?: number | undefined;
  readonly cache_creation_input_token_cost?: number | undefined;
  readonly cache_creation_input_token_cost_above_1hr?: number | undefined;
  readonly long_context?: LiteLLMLongContext | undefined;
}

/** USD per million tokens, rounded to remove floating-point noise but keep the precision of cheap cache reads. */
function perMillion(value: number): number {
  return Math.round(value * 1_000_000 * 1_000_000) / 1_000_000;
}

/**
 * The tier's rates as LiteLLM's calculator resolves them: a cache kind the tier prices keeps its tier price, one
 * neither the tier nor the base prices bills at the tier's input price, and one only the base prices falls back to
 * the base price. The one-hour write keeps its own two-level fallback, tier over base.
 */
function tierOf(entry: LiteLLMEntry, tier: LiteLLMLongContext): PriceTier {
  const input = perMillion(tier.input_cost_per_token ?? entry.input_cost_per_token);
  const cacheRead = tier.cache_read_input_token_cost;
  const cacheWrite = tier.cache_creation_input_token_cost;
  const cacheWrite1h = tier.cache_creation_input_token_cost_above_1hr;
  return {
    thresholdTokens: tier.above_tokens,
    input,
    ...(tier.output_cost_per_token === undefined ? {} : { output: perMillion(tier.output_cost_per_token) }),
    ...(cacheRead === undefined
      ? entry.cache_read_input_token_cost === undefined
        ? { cacheRead: input }
        : {}
      : { cacheRead: perMillion(cacheRead) }),
    ...(cacheWrite === undefined
      ? entry.cache_creation_input_token_cost === undefined
        ? { cacheWrite: input }
        : {}
      : { cacheWrite: perMillion(cacheWrite) }),
    ...(cacheWrite1h === undefined ? {} : { cacheWrite1h: perMillion(cacheWrite1h) })
  };
}

/**
 * The `Price` of one LiteLLM entry: a model without a cache write or read price pays its input price there. The
 * conversion is presence's snapshot script's, rounding included.
 */
export function priceOfEntry(entry: LiteLLMEntry): Price {
  const input = perMillion(entry.input_cost_per_token);
  const cacheWrite1h = entry.cache_creation_input_token_cost_above_1hr;
  const tier = entry.long_context;
  return {
    input,
    output: perMillion(entry.output_cost_per_token),
    cacheRead: entry.cache_read_input_token_cost === undefined ? input : perMillion(entry.cache_read_input_token_cost),
    cacheWrite:
      entry.cache_creation_input_token_cost === undefined ? input : perMillion(entry.cache_creation_input_token_cost),
    ...(cacheWrite1h === undefined ? {} : { cacheWrite1h: perMillion(cacheWrite1h) }),
    ...(tier === undefined ? {} : { longContext: tierOf(entry, tier) })
  };
}
