import * as z from "zod/mini";

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

const OptionalCost = z.catch(z.optional(z.number()), undefined);

/** `<N>k` of a field name as a count of tokens: `272k` is 272000, a bare `100000` counts as it is. */
function thresholdTokens(suffix: string): number {
  return suffix.endsWith("k") ? Number(suffix.slice(0, -1)) * 1000 : Number(suffix);
}

/** Parsed long-context tier rates for the largest threshold present on a raw LiteLLM entry. */
export interface ParsedLiteLLMTier {
  readonly above_tokens: number;
  readonly rates: Readonly<Record<string, number>>;
}

/**
 * Extracts the long-context tier from a raw LiteLLM entry's `*_above_<N>k_tokens` fields. When an entry lists more
 * than one threshold, the largest wins.
 */
export function parseLiteLLMTier(entry: unknown): ParsedLiteLLMTier | undefined {
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
  return { above_tokens: largest, rates: tiers.get(largest)! };
}
