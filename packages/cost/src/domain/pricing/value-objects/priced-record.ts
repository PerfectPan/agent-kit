import type { Usage } from "@rivus/agent-kit-sessions/public";

import type { Cost } from "./cost.js";

/** One model's share of a record split by model, or the whole record, with its cost when something prices it. */
export interface PricedPart {
  /** The model of the share, or the record's model; absent when the record names none. */
  readonly model?: string;
  readonly usage: Usage;
  /** The model calls the share, or the whole record, counts; absent when it does not say. */
  readonly modelCalls?: number;
  /** Absent, never 0, when the agent logged no amount and the pricing does not know the model. */
  readonly cost?: Cost;
}

/** A usage record priced by model. */
export interface PricedRecord {
  /** One part per model when the record is split by model, else one part for the whole record. */
  readonly parts: readonly PricedPart[];
}
