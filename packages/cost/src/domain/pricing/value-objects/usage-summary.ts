import type { CodingAgentId } from "@rivus/agent-kit-catalog";
import type { Usage } from "@rivus/agent-kit-sessions";

/** What the groups of a summary are keyed by. */
export type UsageGroupKey = "agent" | "model";

/** Usage and cost totals of some records. */
export interface UsageTotals {
  /** How many records contributed. */
  readonly entries: number;
  /** Token totals in the convention of `Usage`: a count no record had stays absent. */
  readonly usage: Usage;
  /** The sum of the costs that are known; absent when no record had a known cost. */
  readonly costUsd?: number;
}

/** The totals of the records of one agent, one model, or one model of one agent. */
export interface UsageGroup extends UsageTotals {
  /** Present when the summary groups by agent. */
  readonly agent?: CodingAgentId;
  /** Present when the summary groups by model and the record or its split names one. */
  readonly model?: string;
}

/** Usage and cost totals of the records in a window, and by group. */
export interface UsageSummary {
  readonly total: UsageTotals;
  /** In the order of their first record. */
  readonly groups: readonly UsageGroup[];
}
