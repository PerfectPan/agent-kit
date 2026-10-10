import * as z from "zod/mini";

import type { Price } from "../value-objects/price.js";
import { lenient } from "./lenient.js";
import type { PricingTable } from "../value-objects/pricing-table.js";

/** The entry of LiteLLM's list that documents the fields instead of pricing a model. */
const SAMPLE_KEY = "sample_spec";

/** One price field: a finite number of USD per token; anything else prices nothing. */
const CostField = z.number();

/**
 * The fields of LiteLLM's list this reads; every other field of an entry is ignored. The two prices an entry needs
 * decide whether it prices a model, but a cache price of another kind only means that price is unknown: it reads as
 * absent, and the entry pays its input price there.
 */
const Entry = z.object({
  input_cost_per_token: CostField,
  output_cost_per_token: CostField,
  cache_read_input_token_cost: lenient(z.optional(CostField), undefined),
  cache_creation_input_token_cost: lenient(z.optional(CostField), undefined),
  cache_creation_input_token_cost_above_1hr: lenient(z.optional(CostField), undefined)
});

/** USD per million tokens, rounded to remove floating-point noise but keep the precision of cheap cache reads. */
function perMillion(value: number): number {
  return Math.round(value * 1_000_000 * 1_000_000) / 1_000_000;
}

function priceOf(entry: z.output<typeof Entry>): Price {
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

/**
 * A `PricingTable` from LiteLLM's model price list (`model_prices_and_context_window.json`), whose prices are USD per
 * token, under LiteLLM's keys. An entry needs `input_cost_per_token` and `output_cost_per_token`; cache writes take
 * `cache_creation_input_token_cost` and one-hour cache writes `cache_creation_input_token_cost_above_1hr`, cache reads
 * `cache_read_input_token_cost`, and a model without a cache write or read price pays its input price there. Tiered
 * (`_above_200k_tokens`), batch, flex and priority prices are not read; `pricingMultiplier` covers a priority tier.
 * The conversion is presence's snapshot script's, rounding included. This is the adapter for LiteLLM's format: the
 * list is parsed once here, and an entry whose fields do not price a model is dropped, not the table.
 */
export function fromLiteLLM(json: unknown): PricingTable {
  const list = z.record(z.string(), z.unknown()).safeParse(json);
  const table: Record<string, Price> = {};
  if (!list.success) {
    return table;
  }
  for (const [model, entry] of Object.entries(list.data)) {
    if (model === SAMPLE_KEY) {
      continue;
    }
    const parsed = Entry.safeParse(entry);
    if (parsed.success) {
      table[model] = priceOf(parsed.data);
    }
  }
  return table;
}
