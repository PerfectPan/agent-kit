import type { ContentHash } from "../../ledger/value-objects/content-hash.js";
import type { LedgerEntry } from "../../ledger/entities/ledger-entry.js";
import type { ObservedArtifact } from "./observed-artifact.js";
import type { PlanStep } from "./plan-step.js";
import { touchesDisk } from "./plan-step.js";

/**
 * What a step expects at its target when the plan was built, re-checked right before the step writes: nothing there,
 * content with this hash, or (for a step that changes only the ledger) the LedgerEntry still at this
 * `entryRevision`. The re-check narrows the window for a writer outside the LedgerLock; it is not a compare-and-swap.
 */
export type Precondition = { readonly absent: true } | { readonly hash: ContentHash } | { readonly ownedAt: number };

/**
 * Whether the target still holds what the step expects: an `ownedAt` step needs the LedgerEntry at that revision, an
 * observable step needs the same hash, or nothing there. Symlinks and ForeignOwners are judged separately.
 */
export function preconditionSatisfied(
  step: PlanStep,
  context: { readonly entry?: LedgerEntry; readonly observed?: ObservedArtifact }
): boolean {
  const { precondition } = step;
  if ("ownedAt" in precondition) {
    return context.entry?.entryRevision === precondition.ownedAt;
  }
  const { observed } = context;
  return "absent" in precondition ? observed === undefined : observed?.hash === precondition.hash;
}

/** Whether a step that writes may touch what it observed: a write never follows a symlink at the target itself. */
export function targetWritable(step: PlanStep, observed: ObservedArtifact | undefined): boolean {
  return !touchesDisk(step) || step.locator.kind === "symlink" || observed?.symlinkTarget === undefined;
}

/**
 * Whether a step can still run, re-checked right before it writes (planning checks `preconditionSatisfied` alone):
 * its precondition still holds and a write would not replace a symlink.
 */
export function preconditionHolds(
  step: PlanStep,
  context: { readonly entry?: LedgerEntry; readonly observed?: ObservedArtifact }
): boolean {
  return preconditionSatisfied(step, context) && targetWritable(step, context.observed);
}
