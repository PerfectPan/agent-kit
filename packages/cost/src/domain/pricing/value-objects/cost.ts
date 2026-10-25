import type { CostSource } from "@rivus/agent-kit-sessions/public";

/**
 * An amount in USD and where it comes from, under the names a `UsageRecord` uses, so `{ ...record, ...cost }` is the
 * priced record; `priceRecord` gives a record split by model one per model.
 */
export interface Cost {
  readonly costUsd: number;
  readonly costSource: CostSource;
}
