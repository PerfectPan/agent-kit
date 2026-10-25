import * as z from "zod/mini";

import type { Price } from "../value-objects/price.js";
import { lenient } from "../../../lib/lenient.js";
import type { PricingTable } from "../value-objects/pricing-table.js";
import { priceOfEntry } from "./litellm-entry.js";

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

/**
 * A `PricingTable` from LiteLLM's model price list (`model_prices_and_context_window.json`), whose prices are USD per
 * token, under LiteLLM's keys. An entry needs `input_cost_per_token` and `output_cost_per_token`; cache writes take
 * `cache_creation_input_token_cost` and one-hour cache writes `cache_creation_input_token_cost_above_1hr`, cache reads
 * `cache_read_input_token_cost`, converted by `priceOfEntry`. `pricingMultiplier` covers a priority tier. This is the
 * adapter for LiteLLM's format: the list is parsed once here, and an entry whose fields do not price a model is
 * dropped, not the table.
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
      table[model] = priceOfEntry(parsed.data);
    }
  }
  return table;
}
