import type { CostSource } from "@rivus/agent-kit-sessions";

/**
 * An amount in USD and where it comes from, under the names a `UsageRecord` uses, so `{ ...record, ...cost }` is the
 * priced record; a record split by model keeps its per-model costs in `summarize`.
 */
export interface Cost {
  readonly costUsd: number;
  readonly costSource: CostSource;
}
