import type { Price } from "../value-objects/price.js";
import type { PricingTable } from "../value-objects/pricing-table.js";

/** The entry of LiteLLM's list that documents the fields instead of pricing a model. */
const SAMPLE_KEY = "sample_spec";

/**
 * A `PricingTable` from LiteLLM's model price list (`model_prices_and_context_window.json`), whose prices are USD per
 * token, under LiteLLM's keys. An entry needs `input_cost_per_token` and `output_cost_per_token`; cache writes take
 * `cache_creation_input_token_cost` and one-hour cache writes `cache_creation_input_token_cost_above_1hr`, cache reads
 * `cache_read_input_token_cost`, and a model without a cache write or read price pays its input price there. Tiered
 * (`_above_200k_tokens`), batch, flex and priority prices are not read; `pricingMultiplier` covers a priority tier.
 * The conversion is presence's snapshot script's, rounding included, and reads fields with `typeof` checks because
 * `/cost` imports no validation library.
 */
export function fromLiteLLM(json: unknown): PricingTable {
  const table: Record<string, Price> = {};
  if (typeof json !== "object" || json === null) {
    return table;
  }
  for (const [model, entry] of Object.entries(json)) {
    const price = model === SAMPLE_KEY ? undefined : priceOf(entry);
    if (price !== undefined) {
      table[model] = price;
    }
  }
  return table;
}

function priceOf(entry: unknown): Price | undefined {
  if (typeof entry !== "object" || entry === null) {
    return undefined;
  }
  const field = (name: string) => perMillion((entry as Record<string, unknown>)[name]);
  const input = field("input_cost_per_token");
  const output = field("output_cost_per_token");
  if (input === undefined || output === undefined) {
    return undefined;
  }
  const cacheWrite1h = field("cache_creation_input_token_cost_above_1hr");
  return {
    input,
    output,
    cacheRead: field("cache_read_input_token_cost") ?? input,
    cacheWrite: field("cache_creation_input_token_cost") ?? input,
    ...(cacheWrite1h === undefined ? {} : { cacheWrite1h })
  };
}

/** USD per million tokens, rounded to remove floating-point noise but keep the precision of cheap cache reads. */
function perMillion(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return undefined;
  }
  return Math.round(value * 1_000_000 * 1_000_000) / 1_000_000;
}
