import type { Price } from "./price.js";

/**
 * Prices by model, injected by the caller, such as the kit's LiteLLM snapshot from `/cost/prices`. A key names one
 * model; `createPricing` says which ids it prices.
 */
export type PricingTable = Readonly<Record<string, Price>>;

/**
 * Prices that replace the table's for the ids that contain a key; an entry may give only some of them. An entry that
 * says nothing about `longContext` keeps the model's own tier — a full override of the base prices still bills past
 * the threshold at the table's tier; an entry with a `longContext` replaces the tier, and an explicit
 * `longContext: undefined` drops it.
 */
export type PriceOverrides = Readonly<Record<string, Partial<Price>>>;

export interface PricingOptions {
  /**
   * Win over the table and the fallback for every id that contains a key, as `createPricing` says. A partial entry
   * takes the prices it lacks from the price the id has without overrides; when it has none, the id has no price.
   */
  readonly overrides?: PriceOverrides;
  /**
   * Family aliases, such as `opus` or `gpt-5`, for ids that no table key matches: such a model takes the longest key
   * its id contains.
   */
  readonly fallback?: PricingTable;
}

/** The price lookup over an injected table. */
export interface Pricing {
  /** The price of `model`, or `undefined` when no key matches: an unknown model has no price, not a price of 0. */
  priceOf(model: string): Price | undefined;
}

/**
 * A date that names a snapshot of the model before it: `-20250929` (Anthropic), `-2025-08-07` (OpenAI) or Vertex AI's
 * `@20250929`. Other endings, such as `-latest`, `-preview`, `-mini` or a four-digit `-0309`, can name another model.
 */
const DATED = /(?:[-@]\d{8}|-\d{4}-\d{2}-\d{2})$/;

function lowered<T>(table: Readonly<Record<string, T>>): Map<string, T> {
  return new Map(Object.entries(table).map(([key, value]) => [key.toLowerCase(), value]));
}

/** The entry of the longest key that `id` contains, the first given among equally long keys. */
function longest<T>(id: string, entries: ReadonlyMap<string, T>): T | undefined {
  let best = "";
  for (const key of entries.keys()) {
    if (id.includes(key) && key.length > best.length) {
      best = key;
    }
  }
  return entries.get(best);
}

function complete(price: Partial<Price>): Price | undefined {
  const { input, output, cacheRead, cacheWrite, cacheWrite1h, longContext } = price;
  if (input === undefined || output === undefined || cacheRead === undefined || cacheWrite === undefined) {
    return undefined;
  }
  return {
    input,
    output,
    cacheRead,
    cacheWrite,
    ...(cacheWrite1h === undefined ? {} : { cacheWrite1h }),
    // The tier is one field: an override that lacks it keeps the model's own, one that has it replaces it.
    ...(longContext === undefined ? {} : { longContext })
  };
}

/**
 * The price lookup over `table`. Keys match regardless of case.
 *
 * Table keys name one model each. A key prices a model whose id is the key, the key followed by a date (`-20250929`,
 * `-2025-08-07` or `@20250929`), or either after one `<provider>/` prefix: `claude-sonnet-4-5` prices
 * `claude-sonnet-4-5-20250929`, `claude-sonnet-4-5@20250929` and `anthropic/claude-sonnet-4-5`. Any other ending
 * names another model, so `gpt-5` prices none of `gpt-5.7`, `gpt-5-codex` or `gpt-5-mini`, and `o1` does not price
 * `o1-mini`. Among the keys an id matches, the id itself wins, then the id without its date, then both without
 * the prefix.
 *
 * `fallback` keys are family aliases, used only when no table key matches: a model takes the longest fallback key its
 * id contains, the first given among equally long keys, so `opus` prices `claude-opus-4-9` and `gpt-5` prices
 * `gpt-5.7`.
 *
 * `overrides` are the caller's own rules and, unlike table keys, match by substring: a model takes the longest
 * override key its id contains, the first given among equally long keys, and that override wins over the table and
 * the fallback, so `{ opus: … }` reprices both `claude-opus-4-8` and `claude-3-opus`. A partial override takes the
 * prices it lacks from the price the id has without overrides: over a table with `gpt-4o` and `gpt-4o-2024-05-13`,
 * `{ "gpt-4o": { input: 1 } }` keeps the dated model's own output price. A partial override of an id without a price
 * of its own gives no price. An override entry that says nothing about `longContext` keeps the model's own tier, and
 * one with a `longContext` replaces it. A model that nothing prices has no price. Lookups are cached by model id.
 */
export function createPricing(table: PricingTable, options: PricingOptions = {}): Pricing {
  const entries = lowered(table);
  const aliases = lowered(options.fallback ?? {});
  const overrides = lowered(options.overrides ?? {});
  const found = new Map<string, Price | undefined>();
  return {
    priceOf(model) {
      if (found.has(model)) {
        return found.get(model);
      }
      const id = model.toLowerCase();
      const bare = id.slice(id.indexOf("/") + 1);
      const key = [id, id.replace(DATED, ""), bare, bare.replace(DATED, "")].find((name) => entries.has(name));
      const own = key === undefined ? longest(id, aliases) : entries.get(key);
      const override = longest(id, overrides);
      const price = override === undefined ? own : complete({ ...own, ...override });
      found.set(model, price);
      return price;
    }
  };
}
