import { err, ok, type Result } from "@rivus/agent-kit-catalog";

import type { BundleRef } from "../../bundle/value-objects/bundle.js";
import type { PendingOperations } from "../../ledger/errors/pending-operations.js";
import type { InvalidPlan } from "../errors/invalid-plan.js";
import type { PlanConflict } from "../errors/plan-conflict.js";
import { ledgerMovedError, planClosedError, type PlanStale } from "../errors/plan-stale.js";
import { type PlanEvidence, planProblem } from "../policies/plan-invariants.js";
import { conflictChoices } from "../policies/conflict-detection.js";
import type { ArtifactLocator } from "../value-objects/artifact-locator.js";
import type { InstallTarget } from "../value-objects/install-target.js";
import { basisMoved, type PlanBasis } from "../value-objects/plan-basis.js";
import type { PlanStep, StepNote } from "../value-objects/plan-step.js";
import type { TrustPrompt } from "../value-objects/trust-prompt.js";

/** A plan is applied once or discarded; either way it cannot be applied again. */
export type PlanStatus = "ready" | "applied" | "discarded";

export interface InstallPlanSnapshot {
  readonly planId: string;
  readonly basedOn: PlanBasis;
  readonly bundle: BundleRef;
  readonly target: InstallTarget;
  /** In execution order. */
  readonly steps: readonly PlanStep[];
  /** Announced only; the user approves them in the agent. */
  readonly expectedTrustPrompts: readonly TrustPrompt[];
  /** Every step that leaves a file to a ForeignOwner or a symlink instead of deleting or restoring it. */
  readonly notes: readonly { readonly locator: ArtifactLocator; readonly note: StepNote }[];
  readonly status: PlanStatus;
}

export type InstallPlanDraft = Omit<InstallPlanSnapshot, "status" | "notes">;

export type InstallPlanTransition = { readonly state: InstallPlan; readonly events: readonly [] };

function freeze<T>(value: T): T {
  if (typeof value === "object" && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const inner of Object.values(value)) {
      freeze(inner);
    }
  }
  return value;
}

/**
 * The steps that would bring the agents' harnesses from what is on disk and in the ledger to what a bundle wants.
 * Its content never changes after it is built (it deep-freezes the draft, desired content included); it is applied
 * once against the ledger revision it was built on, or discarded.
 */
export class InstallPlan {
  /**
   * Checks the plan invariants again against the ledger the draft was built on and what was observed (see
   * `planProblem`), then rejects the plan as a whole while any step is a conflict.
   */
  static create(
    draft: InstallPlanDraft,
    evidence: PlanEvidence
  ): Result<InstallPlan, PendingOperations | PlanStale | InvalidPlan | PlanConflict> {
    const { ledger } = evidence;
    if (ledger.pending.length > 0) {
      return err({ _tag: "PendingOperations", operations: ledger.pending });
    }
    if (basisMoved(draft.basedOn, ledger)) {
      return err(ledgerMovedError(draft.planId, draft.basedOn, ledger));
    }
    const problem = planProblem(draft.steps, draft.bundle.owner, draft.target, evidence);
    if (problem !== undefined) {
      return err(problem);
    }
    const conflicts = draft.steps.flatMap((step) =>
      step.action === "conflict" ? [{ step, choices: conflictChoices(step, ledger.entry(step.locator)) }] : []
    );
    if (conflicts.length > 0) {
      return err({ _tag: "PlanConflict", planId: draft.planId, conflicts });
    }
    const notes = draft.steps.flatMap(({ locator, note }) => (note === undefined ? [] : [{ locator, note }]));
    return ok(new InstallPlan({ ...draft, notes, status: "ready" }));
  }

  private readonly snapshot: InstallPlanSnapshot;

  private constructor(snapshot: InstallPlanSnapshot) {
    this.snapshot = freeze(snapshot);
    Object.freeze(this);
  }

  get planId(): string {
    return this.snapshot.planId;
  }

  get basedOn(): PlanBasis {
    return this.snapshot.basedOn;
  }

  get bundle(): BundleRef {
    return this.snapshot.bundle;
  }

  get target(): InstallTarget {
    return this.snapshot.target;
  }

  get steps(): readonly PlanStep[] {
    return this.snapshot.steps;
  }

  get expectedTrustPrompts(): readonly TrustPrompt[] {
    return this.snapshot.expectedTrustPrompts;
  }

  get notes(): InstallPlanSnapshot["notes"] {
    return this.snapshot.notes;
  }

  /** The Artifacts the plan leaves on disk as the user's: removals kept because the user changed them. */
  get kept(): readonly ArtifactLocator[] {
    return this.snapshot.steps.flatMap((step) =>
      step.action === "remove" && step.removal === "keep" && step.drift === "user-modified" ? [step.locator] : []
    );
  }

  get status(): PlanStatus {
    return this.snapshot.status;
  }

  /**
   * Why this plan can no longer be applied against `ledger`: it was applied or discarded, or the ledger moved on
   * since the plan was built. `undefined` when it is still ready and the ledger is exactly what it was built on.
   */
  staleAgainst(ledger: { readonly lineage: string; readonly revision: number }): PlanStale | undefined {
    const closed = planClosedError(this.snapshot);
    return closed !== undefined
      ? closed
      : basisMoved(this.basedOn, ledger)
        ? ledgerMovedError(this.planId, this.basedOn, ledger)
        : undefined;
  }

  /** Called once the ledger recorded the plan's steps as pending. */
  markApplied(): Result<InstallPlanTransition, PlanStale> {
    return this.close("applied");
  }

  discard(): Result<InstallPlanTransition, PlanStale> {
    return this.close("discarded");
  }

  toSnapshot(): InstallPlanSnapshot {
    return this.snapshot;
  }

  private close(status: Exclude<PlanStatus, "ready">): Result<InstallPlanTransition, PlanStale> {
    const error = planClosedError({ ...this.snapshot, status: this.status });
    if (error !== undefined) {
      return err(error);
    }
    return ok({ state: new InstallPlan({ ...this.snapshot, status }), events: [] });
  }
}
