import * as z from "zod/mini";

import type { LiteLLMLongContext } from "./litellm-entry.js";
import type { Price } from "../value-objects/price.js";
import { lenient } from "../../../lib/lenient.js";
import type { PricingTable } from "../value-objects/pricing-table.js";
import { priceOfEntry } from "./litellm-entry.js";

/** The entry of LiteLLM's list that documents the fields instead of pricing a model. */
const SAMPLE_KEY = "sample_spec";

/** One price field: a finite number of USD per token; anything else prices nothing. */
const CostField = z.number();

/** A cache price of another kind only means that price is unknown: it reads as absent, and the entry pays its input price there. */
const OptionalCost = lenient(z.optional(CostField), undefined);

/** One `*_above_<N>k_tokens` tier of the list, under the names the snapshot keeps it by. */
const LongContext = z.object({
  above_tokens: z.number(),
  input_cost_per_token: OptionalCost,
  output_cost_per_token: OptionalCost,
  cache_read_input_token_cost: OptionalCost,
  cache_creation_input_token_cost: OptionalCost,
  cache_creation_input_token_cost_above_1hr: OptionalCost
});

/**
 * The fields of LiteLLM's list this reads; every other field of an entry is ignored. The two prices an entry needs
 * decide whether it prices a model, but a cache price of another kind only means that price is unknown: it reads as
 * absent, and the entry pays its input price there. `long_context` is the tier as the snapshot keeps it; an entry of
 * the raw list carries no such field, and `tierOf` reads its tier out of the flat `*_above_<N>k_tokens` fields.
 */
const Entry = z.object({
  input_cost_per_token: CostField,
  output_cost_per_token: CostField,
  cache_read_input_token_cost: OptionalCost,
  cache_creation_input_token_cost: OptionalCost,
  cache_creation_input_token_cost_above_1hr: OptionalCost,
  long_context: lenient(z.optional(LongContext), undefined)
});

/**
 * The four rates a long-context tier can reprice, above `<N>k` (or bare) counts of tokens; the first group is the
 * field's name under the tier. A service tier's variant (`…_tokens_flex`, `…_tokens_priority`, `_batches`, and the
 * like) does not end in `_tokens` and is not a tier field, and neither is the tier of another cache lifetime
 * (`cache_creation_input_token_cost_above_12hr_above_…_tokens`).
 */
const TIERED =
  /^(input_cost_per_token|output_cost_per_token|cache_read_input_token_cost|cache_creation_input_token_cost)_above_([0-9]+k?)_tokens$/;

/** The tier's one-hour cache writes, the one field whose name carries its lifetime before the threshold. */
const TIERED_1H = /^cache_creation_input_token_cost_above_1hr_above_([0-9]+k?)_tokens$/;

/** `<N>k` of a field name as a count of tokens: `272k` is 272000, a bare `100000` counts as it is. */
function thresholdTokens(suffix: string): number {
  return suffix.endsWith("k") ? Number(suffix.slice(0, -1)) * 1000 : Number(suffix);
}

/**
 * The long-context tier of one raw entry of LiteLLM's list, its threshold parsed from the `*_above_<N>k_tokens`
 * field names. A tier keeps the fields LiteLLM lists under it; when an entry listed more than one threshold, the
 * largest would win — no entry lists two.
 */
function tierOf(entry: unknown): LiteLLMLongContext | undefined {
  const fields = z.record(z.string(), z.unknown()).safeParse(entry);
  if (!fields.success) {
    return undefined;
  }
  const tiers = new Map<number, Record<string, number>>();
  let largest: number | undefined;
  for (const [key, value] of Object.entries(fields.data)) {
    const rate = OptionalCost.parse(value);
    if (rate === undefined) {
      continue;
    }
    const flat = TIERED.exec(key);
    const over1h = flat === null ? TIERED_1H.exec(key) : null;
    if (flat === null && over1h === null) {
      continue;
    }
    const threshold = thresholdTokens(flat === null ? over1h![1]! : flat[2]!);
    const rates = tiers.get(threshold) ?? {};
    rates[flat === null ? "cache_creation_input_token_cost_above_1hr" : flat[1]!] = rate;
    tiers.set(threshold, rates);
    if (largest === undefined || threshold > largest) {
      largest = threshold;
    }
  }
  if (largest === undefined) {
    return undefined;
  }
  return { above_tokens: largest, ...tiers.get(largest)! };
}

/**
 * A `PricingTable` from LiteLLM's model price list (`model_prices_and_context_window.json`), whose prices are USD per
 * token, under LiteLLM's keys. An entry needs `input_cost_per_token` and `output_cost_per_token`; cache writes take
 * `cache_creation_input_token_cost` and one-hour cache writes `cache_creation_input_token_cost_above_1hr`, cache reads
 * `cache_read_input_token_cost`, converted by `priceOfEntry`, which also reads the entry's `*_above_<N>k_tokens`
 * tier. `pricingMultiplier` covers a priority tier. This is the adapter for LiteLLM's format: the list is parsed once
 * here, and an entry whose fields do not price a model is dropped, not the table.
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
      const tier = parsed.data.long_context ?? tierOf(entry);
      table[model] = priceOfEntry(tier === undefined ? parsed.data : { ...parsed.data, long_context: tier });
    }
  }
  return table;
}
