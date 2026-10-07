import type { ConflictChoice } from "../value-objects/conflict.js";
import type { PlanStep } from "../value-objects/plan-step.js";

/**
 * The plan has conflicts without an explicit choice, so it is rejected as a whole before anything is written. Each
 * conflicting step lists the choices that would resolve it; an empty list means no choice can.
 */
export interface PlanConflict {
  readonly _tag: "PlanConflict";
  readonly planId: string;
  readonly conflicts: readonly { readonly step: PlanStep; readonly choices: readonly ConflictChoice[] }[];
}
