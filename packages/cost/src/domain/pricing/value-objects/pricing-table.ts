import type { Price } from "./price.js";

/**
 * Prices by model, injected by the caller: the kit ships no price data. A key is a model id or a part of model ids,
 * such as a family alias (`opus`); `createPricing` says how a model finds its key.
 */
export type PricingTable = Readonly<Record<string, Price>>;

/** Prices that replace a table's for the same keys; an entry may give only some of them. */
export type PriceOverrides = Readonly<Record<string, Partial<Price>>>;

export interface PricingOptions {
  /**
   * Win over the table and the fallback. A partial entry takes the prices it lacks from the table's entry with the
   * same key, else the fallback's; when neither has one, the models it matches have no price.
   */
  readonly overrides?: PriceOverrides;
  /**
   * Entries the table lacks, such as family aliases for ids that a price list does not have yet. They take part in the
   * same match as the table's entries; for the same key, the table's entry wins.
   */
  readonly fallback?: PricingTable;
}

/** The price lookup over an injected table. */
export interface Pricing {
  /** The price of `model`, or `undefined` when no key matches: an unknown model has no price, not a price of 0. */
  priceOf(model: string): Price | undefined;
}

/**
 * The price lookup over `table`, with presence's rules. Keys match regardless of case. A model takes the entry of a
 * matching override key when there is one, else of a table or fallback key; among the keys of each, its own id wins,
 * then the longest key that its id contains, so `claude-opus-4-8-20260101` takes `claude-opus-4-8` over `opus`. Over
 * a whole price list, a short key can match an id it was not meant for: keep the models you price, as presence's
 * snapshot does. Lookups are cached by model id.
 */
export function createPricing(table: PricingTable, options: PricingOptions = {}): Pricing {
  const entries = new Map<string, Price>();
  for (const source of [options.fallback ?? {}, table]) {
    for (const [key, price] of Object.entries(source)) {
      entries.set(key.toLowerCase(), price);
    }
  }
  const overrides = new Map<string, Price | undefined>();
  for (const [key, partial] of Object.entries(options.overrides ?? {})) {
    const id = key.toLowerCase();
    overrides.set(id, complete({ ...entries.get(id), ...partial }));
  }
  const found = new Map<string, Price | undefined>();
  return {
    priceOf(model) {
      if (found.has(model)) {
        return found.get(model);
      }
      const id = model.toLowerCase();
      const override = keyOf(id, overrides);
      let price: Price | undefined;
      if (override !== undefined) {
        price = overrides.get(override);
      } else {
        const key = keyOf(id, entries);
        price = key === undefined ? undefined : entries.get(key);
      }
      found.set(model, price);
      return price;
    }
  };
}

/** `id` when it is a key, else the longest key that `id` contains; the first one inserted among equally long keys. */
function keyOf(id: string, keys: ReadonlyMap<string, unknown>): string | undefined {
  if (keys.has(id)) {
    return id;
  }
  let best: string | undefined;
  for (const key of keys.keys()) {
    if (id.includes(key) && (best === undefined || key.length > best.length)) {
      best = key;
    }
  }
  return best;
}

function complete(price: Partial<Price>): Price | undefined {
  const { input, output, cacheRead, cacheWrite, cacheWrite1h } = price;
  if (input === undefined || output === undefined || cacheRead === undefined || cacheWrite === undefined) {
    return undefined;
  }
  return { input, output, cacheRead, cacheWrite, ...(cacheWrite1h === undefined ? {} : { cacheWrite1h }) };
}
