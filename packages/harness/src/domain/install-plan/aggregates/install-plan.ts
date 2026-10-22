import { deepFreeze } from "../../../lib/deep-freeze.js";
import { err, ok, type Result } from "@rivus/agent-kit-catalog/public";
import { type BundleRef } from "../../bundle/value-objects/bundle.js";
import { type PendingOperations } from "../../ledger/errors/pending-operations.js";
import { type InvalidPlan } from "../errors/invalid-plan.js";
import { type PlanConflict } from "../errors/plan-conflict.js";
import { ledgerMovedError, planClosedError, type PlanStale } from "../errors/plan-stale.js";
import { conflictChoices } from "../services/conflict-detection.js";
import {
  type ArtifactLocatorSnapshot,
  locatorKey,
  ArtifactLocator,
  type ArtifactKind
} from "../value-objects/artifact-locator.js";
import { type InstallTargetSnapshot, InstallTarget } from "../value-objects/install-target.js";
import { PlanBasis, type PlanBasisSnapshot } from "../value-objects/plan-basis.js";
import { PlanStep, type PlanStepSnapshot, type StepNote, type PlanAction } from "../value-objects/plan-step.js";
import { type TrustPrompt } from "../value-objects/trust-prompt.js";
import { type OwnerSnapshot } from "../../bundle/value-objects/owner.js";
import { hasLegacyMarker } from "../../bundle/services/legacy-markers.js";
import { type Ledger } from "../../ledger/aggregates/ledger.js";
import { type LedgerEntry } from "../../ledger/entities/ledger-entry.js";
import { type ObservedArtifact } from "../spi/observed-artifact.js";
import { Precondition } from "../value-objects/precondition.js";
import { protectedLegacy } from "../services/legacy-ownership.js";

/** A plan is applied once or discarded; either way it cannot be applied again. */
export type PlanStatus = "ready" | "applied" | "discarded";

export interface InstallPlanSnapshot {
  readonly planId: string;
  readonly basedOn: PlanBasisSnapshot;
  readonly bundle: BundleRef;
  readonly target: InstallTargetSnapshot;
  /** In execution order. */
  readonly steps: readonly PlanStepSnapshot[];
  /** Announced only; the user approves them in the agent. */
  readonly expectedTrustPrompts: readonly TrustPrompt[];
  /** Every step that leaves a file to a ForeignOwner or a symlink instead of deleting or restoring it. */
  readonly notes: readonly { readonly locator: ArtifactLocatorSnapshot; readonly note: StepNote }[];
  readonly status: PlanStatus;
}

export type InstallPlanDraft = Omit<InstallPlanSnapshot, "status" | "notes">;

export type InstallPlanTransition = { readonly state: InstallPlan; readonly events: readonly [] };

/** What a plan's steps are checked against: the ledger it was built on and what the application observed. */
export interface PlanEvidence {
  readonly legacyTexts: ReadonlyMap<ObservedArtifact, string>;
  readonly ledger: Ledger;
  readonly observed: readonly ObservedArtifact[];
  /** The bundle's legacy markers, which a step marked `legacy` must match again. */
  readonly legacyMarkers: readonly string[];
  /** Paths a ForeignOwner manages, by path, whether or not anything is at them yet. */
  readonly managedPaths?: Readonly<Record<string, string>>;
  /** Paths that are symlinks, with their targets, whether or not the Artifact is in them yet. */
  readonly linkedPaths?: Readonly<Record<string, string>>;
}

/**
 * Why the owner may not take this step, judged from the ledger and from what was observed rather than from the
 * step's own flags: a step marked legacy needs observed content that matches the legacy markers at a locator the user
 * did not keep (see `KeptArtifact`); a removal needs an
 * entry the owner holds, and a delete, restore or keep needs the owner to be its only owner and the plan to cover all
 * its agents (a release, the opposite); a step on another owner's entry is only a join of matching content or a
 * forced takeover; overwriting a file nobody recorded needs an explicit adopt or backup, recording one without a
 * write needs its pre-image kept (or such a choice), and taking a symlink's content as the owner's needs an explicit
 * adopt.
 */
function ownershipProblem(
  step: PlanStepSnapshot,
  owner: OwnerSnapshot,
  target: InstallTargetSnapshot,
  evidence: PlanEvidence,
  observed: ObservedArtifact | undefined
): string | undefined {
  const entry = evidence.ledger.entry(step.locator);
  if (step.legacy === true) {
    const text = observed === undefined ? undefined : evidence.legacyTexts.get(observed);
    const matches =
      entry === undefined &&
      observed !== undefined &&
      !protectedLegacy(step.locator, owner, evidence.ledger, evidence.observed) &&
      text !== undefined &&
      hasLegacyMarker(evidence.legacyMarkers, text) &&
      "hash" in step.precondition &&
      step.precondition.hash === observed.hash;
    if (!matches) {
      return "no observed evidence of an older install";
    }
  } else if (step.action === "remove") {
    if (entry === undefined || !entry.heldBy(owner)) {
      return "the owner does not hold it";
    }
    const sole = entry.owners.length === 1 && entry.agents.every((agent) => target.agents.includes(agent));
    if (step.removal === "release") {
      return sole ? "a release that would leave it without owners or agents" : undefined;
    }
    if (!sole) {
      return "other owners or agents still use it";
    }
    if (step.removal === "delete" && entry.preImage.existed) {
      return "a delete of what has a pre-image to restore";
    }
    return step.removal === "restore-pre-image" && !entry.preImage.existed
      ? "a restore without a pre-image"
      : undefined;
  }
  if (step.action === "remove" || step.action === "conflict") {
    return undefined;
  }
  if (entry !== undefined) {
    if (entry.heldBy(owner) || step.choice === "force") {
      return undefined;
    }
    return step.action === "adopt" && step.desired?.hash === entry.contentHash ? undefined : "another owner holds it";
  }
  if (observed === undefined) {
    return undefined;
  }
  const takesLink = step.action === "adopt" && observed.symlinkTarget !== undefined && step.locator.kind !== "symlink";
  if (takesLink && step.choice !== "adopt") {
    return "a symlink's content taken without an explicit adopt";
  }
  const chosen = step.action === "adopt" && (step.choice === "adopt" || step.choice === "backup");
  if (PlanStep.touchesDisk(step) && step.legacy !== true && !chosen) {
    return "an unrecorded file overwritten without an adopt or backup choice";
  }
  // Recording a file nobody recorded makes a later uninstall delete it, unless its pre-image is kept to restore.
  return step.desired !== undefined && step.legacy !== true && !chosen && !step.capturePreImage
    ? "an unrecorded file taken without a pre-image, an adopt or backup choice"
    : undefined;
}

/**
 * Why a step does not fit what was observed: a precondition other than what is on disk, or a write or delete at a
 * path a ForeignOwner manages or through a symlink at the Artifact.
 */
function observationProblem(
  step: PlanStepSnapshot,
  observed: ObservedArtifact | undefined,
  entry: LedgerEntry | undefined,
  outside: { readonly managedBy: string | undefined; readonly symlinkTarget: string | undefined }
): InvalidPlan | undefined {
  const { locator } = step;
  const condition = Precondition.restore(step.precondition);
  if (!condition.ok || !condition.value.satisfied({ entry, observed })) {
    return {
      _tag: "InvalidPlan",
      reason: "invalid-step",
      locator,
      detail: "a precondition other than what was observed"
    };
  }
  const foreign =
    (outside.managedBy ?? observed?.managedBy) !== undefined ||
    ((outside.symlinkTarget ?? observed?.symlinkTarget) !== undefined && locator.kind !== "symlink");
  return foreign && step.action !== "conflict" && PlanStep.touchesDisk(step)
    ? {
        _tag: "InvalidPlan",
        reason: "not-owned",
        locator,
        detail: "a write or delete at a dotfiles-managed or symlinked path"
      }
    : undefined;
}

/** Containers before what they hold, and files before the entries and registrations that name them. */
const KIND_ORDER: readonly ArtifactKind[] = [
  "dir",
  "file",
  "symlink",
  "managed-block",
  "json-entry",
  "toml-entry",
  "cli-registration"
];

const PHASE: Readonly<Record<PlanAction, number>> = {
  create: 0,
  update: 0,
  adopt: 0,
  remove: 1,
  noop: 2,
  conflict: 3
};

/**
 * The steps that would bring the agents' harnesses from what is on disk and in the ledger to what a bundle wants.
 * Its content never changes after it is built (it deep-freezes a copy, desired content included); it is applied
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
      return err({ _tag: "PendingOperations", operations: ledger.toSnapshot().pending });
    }
    if (PlanBasis.restore(draft.basedOn).moved(ledger)) {
      return err(ledgerMovedError(draft.planId, draft.basedOn, ledger));
    }
    const steps = InstallPlan.orderSteps(draft.steps);
    const problem = InstallPlan.planProblem(steps, draft.bundle.owner, draft.target, evidence);
    if (problem !== undefined) {
      return err(problem);
    }
    const conflicts = steps.flatMap((step) =>
      step.action === "conflict" ? [{ step, choices: conflictChoices(step, ledger.entry(step.locator)) }] : []
    );
    if (conflicts.length > 0) {
      return err({ _tag: "PlanConflict", planId: draft.planId, conflicts });
    }
    const notes = steps.flatMap(({ locator, note }) => (note === undefined ? [] : [{ locator, note }]));
    const rank = new Map(steps.map((step, index) => [locatorKey(step.locator), index]));
    const expectedTrustPrompts = draft.expectedTrustPrompts.toSorted(
      (a, b) => (rank.get(locatorKey(a.locator)) ?? steps.length) - (rank.get(locatorKey(b.locator)) ?? steps.length)
    );
    return ok(new InstallPlan({ ...draft, steps, expectedTrustPrompts, notes, status: "ready" }));
  }

  private readonly planSteps: readonly PlanStep[];

  private readonly snapshot: InstallPlanSnapshot;

  private constructor(snapshot: InstallPlanSnapshot) {
    this.snapshot = deepFreeze(structuredClone(snapshot));
    this.planSteps = Object.freeze(
      snapshot.steps.map((step) => {
        const restored = PlanStep.restore(step);
        if (!restored.ok) {
          throw new Error(restored.error);
        }
        return restored.value;
      })
    );
    Object.freeze(this);
  }

  get planId(): string {
    return this.snapshot.planId;
  }

  get basedOn(): PlanBasisSnapshot {
    return this.snapshot.basedOn;
  }

  get bundle(): BundleRef {
    return this.snapshot.bundle;
  }

  get target(): InstallTargetSnapshot {
    return this.snapshot.target;
  }

  get steps(): readonly PlanStep[] {
    return this.planSteps;
  }

  get expectedTrustPrompts(): readonly TrustPrompt[] {
    return this.snapshot.expectedTrustPrompts;
  }

  get notes(): InstallPlanSnapshot["notes"] {
    return this.snapshot.notes;
  }

  /** The Artifacts the plan leaves on disk as the user's: removals kept because the user changed them. */
  get kept(): readonly ArtifactLocatorSnapshot[] {
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
      : PlanBasis.restore(this.basedOn).moved(ledger)
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
  /**
   * The plan invariants, checked again on the finished draft instead of trusting the factory: valid locators inside the
   * roots, no step on or inside another's locator, consistent step fields, preconditions that match what was observed,
   * and only changes the owner may make.
   */
  private static planProblem(
    steps: readonly PlanStepSnapshot[],
    owner: OwnerSnapshot,
    target: InstallTargetSnapshot,
    evidence: PlanEvidence
  ): InvalidPlan | undefined {
    const observed = new Map(evidence.observed.map((artifact) => [locatorKey(artifact.locator), artifact]));
    for (const [index, step] of steps.entries()) {
      const { locator } = step;
      const located = ArtifactLocator.restore(locator);
      if (!located.ok) {
        return { _tag: "InvalidPlan", reason: "invalid-locator", locator, detail: located.error };
      }
      if (!InstallTarget.restore(target).contains(locator)) {
        return { _tag: "InvalidPlan", reason: "outside-roots", locator };
      }
      const other = steps.slice(index + 1).find((later) => located.value.overlaps(later.locator));
      if (other !== undefined) {
        return { _tag: "InvalidPlan", reason: "overlapping-locators", locator, detail: locatorKey(other.locator) };
      }
      const invalidStep = PlanStep.problem(step);
      if (invalidStep !== undefined) {
        return { _tag: "InvalidPlan", reason: "invalid-step", locator, detail: invalidStep };
      }
      const seen = observed.get(located.value.key());
      const at = (paths: Readonly<Record<string, string>> | undefined) =>
        paths !== undefined && Object.hasOwn(paths, locator.path) ? paths[locator.path] : undefined;
      const unobserved = observationProblem(step, seen, evidence.ledger.entry(step.locator), {
        managedBy: at(evidence.managedPaths),
        symlinkTarget: at(evidence.linkedPaths)
      });
      if (unobserved !== undefined) {
        return unobserved;
      }
      const notOwned = ownershipProblem(step, owner, target, evidence, seen);
      if (notOwned !== undefined) {
        return { _tag: "InvalidPlan", reason: "not-owned", locator, detail: notOwned };
      }
    }
    return undefined;
  }
  /**
   * The order in which an executor runs the steps: every write first, in KIND_ORDER and then by locator; then removals
   * in exactly the reverse order, so a registration goes before the files it names and a plugin before the marketplace
   * that lists it; then noops. A replacement is written before what it replaces is removed, so an interrupted apply
   * leaves at worst both (which the next plan cleans up), never neither.
   */
  private static orderSteps(steps: readonly PlanStepSnapshot[]): PlanStepSnapshot[] {
    const rank = (step: PlanStepSnapshot): number => {
      const kind = KIND_ORDER.indexOf(step.locator.kind);
      return step.action === "remove" ? KIND_ORDER.length - kind : kind;
    };
    const byKey = (a: PlanStepSnapshot, b: PlanStepSnapshot): number => {
      const order =
        locatorKey(a.locator) < locatorKey(b.locator) ? -1 : locatorKey(a.locator) > locatorKey(b.locator) ? 1 : 0;
      return a.action === "remove" ? -order : order;
    };
    return steps.toSorted((a, b) => PHASE[a.action] - PHASE[b.action] || rank(a) - rank(b) || byKey(a, b));
  }
}
