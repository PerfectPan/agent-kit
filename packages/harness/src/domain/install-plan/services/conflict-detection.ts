import type { LedgerEntry } from "../../ledger/entities/ledger-entry.js";
import type { PlanStepSnapshot } from "../value-objects/plan-step.js";
import { Conflict, type ConflictChoice } from "../value-objects/conflict.js";
/**
 * The choices that resolve one conflicting step (see CONFLICT_CHOICES): `adopt` resolves a symlinked target only for
 * content nobody recorded that needs no write, which is the only case `guardDisk` lets it through.
 */
export function conflictChoices(step: PlanStepSnapshot, entry: LedgerEntry | undefined): readonly ConflictChoice[] {
  if (step.conflict === "symlinked-target") {
    const matching =
      step.desired !== undefined && "hash" in step.precondition && step.precondition.hash === step.desired.hash;
    return matching && entry === undefined ? ["adopt"] : [];
  }
  return step.conflict === undefined ? [] : Conflict.restore(step.conflict).choices();
}
