import type { CostSource, ModelUsage, Usage, UsageRecord } from "@rivus/agent-kit-sessions";

import type { Cost } from "../value-objects/cost.js";
import type { Price } from "../value-objects/price.js";
import type { Pricing } from "../value-objects/pricing-table.js";

/** One model's part of a record, with its cost when that is known. */
export interface UsagePortion {
  readonly model?: string;
  readonly usage: Usage;
  readonly cost?: Cost;
}

/**
 * The cost of a record, by three rules in order: (1) an amount the record carries (`costUsd`), such as one the agent
 * logged, wins; (2) otherwise each token count is charged at the model's price; (3) that amount is multiplied by the
 * record's `pricingMultiplier`. An agent's own amount is what it billed, so the multiplier does not apply to it. A
 * record split by model (`usageByModel`) is charged model by model, each share from its own amount or at its own
 * price, and its aggregate counts are not charged again (see `portionsOf`); `summarize` charges records the same way.
 * A count the record lacks costs nothing; a record without a model, or with a model that the pricing does not know,
 * has no cost: `undefined`, never 0.
 */
export function costOf(record: UsageRecord, pricing: Pricing): Cost | undefined {
  let costUsd = 0;
  let costSource: CostSource = "agent";
  for (const { cost } of portionsOf(record, pricing)) {
    if (cost === undefined) {
      return undefined;
    }
    costUsd += cost.costUsd;
    if (cost.costSource === "pricing-table") {
      costSource = "pricing-table";
    }
  }
  return { costUsd, costSource };
}

/** A record, or one model's share of its split. */
type Part = Pick<ModelUsage, "usage" | "costUsd" | "costSource"> & { readonly model?: string };

/**
 * The record by model, as `costOf` and `summarize` charge it: one portion per model of its split, or the whole record
 * as one portion. A split replaces the aggregate, never adds to it, and wins over it: when the agent logged an amount
 * for the record and for every model, the models' amounts are used. The record stays whole only when the agent logged
 * an amount for it that the split does not divide among every model, because charging the other models at table
 * prices would replace the agent's amount. An amount from a price table on a split record, as `{ ...record,
 * ...costOf(record, pricing) }` leaves it, does not keep the record whole: its models are charged again.
 */
export function portionsOf(record: UsageRecord, pricing: Pricing): UsagePortion[] {
  const split = Object.entries(record.usageByModel ?? {});
  const whole =
    split.length === 0 ||
    (record.costUsd !== undefined &&
      record.costSource !== "pricing-table" &&
      !split.every(([, share]) => share.costUsd !== undefined));
  const parts: Part[] = whole ? [record] : split.map(([model, share]) => ({ ...share, model }));
  return parts.map((part) => {
    const cost = costOfPart(part, pricing, record.pricingMultiplier);
    return {
      ...(part.model === undefined ? {} : { model: part.model }),
      usage: part.usage,
      ...(cost === undefined ? {} : { cost })
    };
  });
}

function costOfPart(part: Part, pricing: Pricing, multiplier: number | undefined): Cost | undefined {
  if (part.costUsd !== undefined) {
    return { costUsd: part.costUsd, costSource: part.costSource ?? "agent" };
  }
  const price = part.model === undefined ? undefined : pricing.priceOf(part.model);
  if (price === undefined) {
    return undefined;
  }
  return { costUsd: priceUsage(part.usage, price) * Math.max(0, multiplier ?? 1), costSource: "pricing-table" };
}

/**
 * USD of `usage` at `price`. The terms and their order are those of presence's formula, so both give the same
 * floating-point dollars. Input without cache is computed here rather than with sessions' `noCacheInputTokens`,
 * because cost takes only types from sessions.
 */
function priceUsage(usage: Usage, price: Price): number {
  const cacheRead = usage.cacheReadTokens ?? 0;
  const cacheWrite = usage.cacheWriteTokens ?? 0;
  const cacheWrite1h = Math.min(cacheWrite, Math.max(0, usage.cacheWrite1hTokens ?? 0));
  const noCacheInput = Math.max(0, (usage.inputTokens ?? 0) - cacheRead - cacheWrite);
  return (
    (noCacheInput * price.input +
      (usage.outputTokens ?? 0) * price.output +
      (cacheWrite - cacheWrite1h) * price.cacheWrite +
      cacheWrite1h * (price.cacheWrite1h ?? price.cacheWrite) +
      cacheRead * price.cacheRead) /
    1_000_000
  );
}
