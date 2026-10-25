import type { Price } from "../value-objects/price.js";

/**
 * The prices of one entry of LiteLLM's model price list that the kit reads, in USD per token, under LiteLLM's field
 * names. Tiered (`_above_200k_tokens`), batch, flex and priority prices are not read.
 */
export interface LiteLLMEntry {
  readonly input_cost_per_token: number;
  readonly output_cost_per_token: number;
  readonly cache_read_input_token_cost?: number | undefined;
  readonly cache_creation_input_token_cost?: number | undefined;
  readonly cache_creation_input_token_cost_above_1hr?: number | undefined;
}

/** USD per million tokens, rounded to remove floating-point noise but keep the precision of cheap cache reads. */
function perMillion(value: number): number {
  return Math.round(value * 1_000_000 * 1_000_000) / 1_000_000;
}

/**
 * The `Price` of one LiteLLM entry: a model without a cache write or read price pays its input price there. The
 * conversion is presence's snapshot script's, rounding included.
 */
export function priceOfEntry(entry: LiteLLMEntry): Price {
  const input = perMillion(entry.input_cost_per_token);
  const cacheWrite1h = entry.cache_creation_input_token_cost_above_1hr;
  return {
    input,
    output: perMillion(entry.output_cost_per_token),
    cacheRead: entry.cache_read_input_token_cost === undefined ? input : perMillion(entry.cache_read_input_token_cost),
    cacheWrite:
      entry.cache_creation_input_token_cost === undefined ? input : perMillion(entry.cache_creation_input_token_cost),
    ...(cacheWrite1h === undefined ? {} : { cacheWrite1h: perMillion(cacheWrite1h) })
  };
}
