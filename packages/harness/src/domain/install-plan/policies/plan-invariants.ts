import type { Owner } from "../../bundle/value-objects/owner.js";
import { isLegacyArtifact } from "../../bundle/policies/legacy-markers.js";
import type { Ledger } from "../../ledger/aggregates/ledger.js";
import type { LedgerEntry } from "../../ledger/entities/ledger-entry.js";
import { holds } from "../../ledger/policies/ownership.js";
import { isContentHash } from "../../ledger/value-objects/content-hash.js";
import type { InvalidPlan } from "../errors/invalid-plan.js";
import { isWithin, locatorKey, locatorProblem, locatorsOverlap } from "../value-objects/artifact-locator.js";
import type { InstallTarget } from "../value-objects/install-target.js";
import type { ObservedArtifact } from "../value-objects/observed-artifact.js";
import { type PlanStep, touchesDisk } from "../value-objects/plan-step.js";
import { preconditionSatisfied } from "../value-objects/precondition.js";
import { protectedLegacy } from "./legacy-ownership.js";

/** What a plan's steps are checked against: the ledger it was built on and what the application observed. */
export interface PlanEvidence {
  readonly ledger: Ledger;
  readonly observed: readonly ObservedArtifact[];
  /** The bundle's legacy markers, which a step marked `legacy` must match again. */
  readonly legacyMarkers: readonly string[];
  /** Paths a ForeignOwner manages, by path, whether or not anything is at them yet. */
  readonly managedPaths?: Readonly<Record<string, string>>;
  /** Paths that are symlinks, with their targets, whether or not the Artifact is in them yet. */
  readonly linkedPaths?: Readonly<Record<string, string>>;
}

const isRevision = (value: number): boolean => Number.isSafeInteger(value) && value >= 0;

/** Why a step's own fields are inconsistent, so that no transition can record something `restore` would refuse. */
function shapeProblem(step: PlanStep): string | undefined {
  const { action, desired, precondition, removal } = step;
  if (action === "conflict" && step.conflict === undefined) {
    return "a conflict without a reason";
  }
  if (
    "hash" in precondition
      ? !isContentHash(precondition.hash)
      : "ownedAt" in precondition && !isRevision(precondition.ownedAt)
  ) {
    return "an invalid precondition";
  }
  if (desired !== undefined && !isContentHash(desired.hash)) {
    return "an invalid desired hash";
  }
  if ((action === "create" || action === "update" || action === "adopt") && desired === undefined) {
    return `${action} without desired content`;
  }
  if (action === "remove" ? removal === undefined : removal !== undefined && action !== "conflict") {
    return "a removal kind on the wrong action";
  }
  if (step.capturePreImage && !("hash" in precondition)) {
    return "a pre-image to capture where nothing is";
  }
  const recorded = (action !== "remove" && action !== "conflict" && desired !== undefined) || removal === "release";
  return recorded && step.agents.length === 0 ? "no agents for an Artifact the ledger records" : undefined;
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
  step: PlanStep,
  owner: Owner,
  target: InstallTarget,
  evidence: PlanEvidence,
  observed: ObservedArtifact | undefined
): string | undefined {
  const entry = evidence.ledger.entry(step.locator);
  if (step.legacy === true) {
    const matches =
      entry === undefined &&
      observed !== undefined &&
      !protectedLegacy(step.locator, owner, evidence.ledger, evidence.observed) &&
      isLegacyArtifact(evidence.legacyMarkers, observed.content) &&
      "hash" in step.precondition &&
      step.precondition.hash === observed.hash;
    if (!matches) {
      return "no observed evidence of an older install";
    }
  } else if (step.action === "remove") {
    if (entry === undefined || !holds(entry, owner)) {
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
    if (holds(entry, owner) || step.choice === "force") {
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
  if (touchesDisk(step) && step.legacy !== true && !chosen) {
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
  step: PlanStep,
  observed: ObservedArtifact | undefined,
  entry: LedgerEntry | undefined,
  outside: { readonly managedBy: string | undefined; readonly symlinkTarget: string | undefined }
): InvalidPlan | undefined {
  const { locator } = step;
  if (!preconditionSatisfied(step, { entry, observed })) {
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
  return foreign && step.action !== "conflict" && touchesDisk(step)
    ? {
        _tag: "InvalidPlan",
        reason: "not-owned",
        locator,
        detail: "a write or delete at a dotfiles-managed or symlinked path"
      }
    : undefined;
}

/**
 * The plan invariants, checked again on the finished draft instead of trusting the factory: valid locators inside the
 * roots, no step on or inside another's locator, consistent step fields, preconditions that match what was observed,
 * and only changes the owner may make.
 */
export function planProblem(
  steps: readonly PlanStep[],
  owner: Owner,
  target: InstallTarget,
  evidence: PlanEvidence
): InvalidPlan | undefined {
  const observed = new Map(evidence.observed.map((artifact) => [locatorKey(artifact.locator), artifact]));
  for (const [index, step] of steps.entries()) {
    const { locator } = step;
    const invalidLocator = locatorProblem(locator);
    if (invalidLocator !== undefined) {
      return { _tag: "InvalidPlan", reason: "invalid-locator", locator, detail: invalidLocator };
    }
    if (!target.roots.some((root) => isWithin(locator.path, root))) {
      return { _tag: "InvalidPlan", reason: "outside-roots", locator };
    }
    const other = steps.slice(index + 1).find((later) => locatorsOverlap(locator, later.locator));
    if (other !== undefined) {
      return { _tag: "InvalidPlan", reason: "overlapping-locators", locator, detail: locatorKey(other.locator) };
    }
    const invalidStep = shapeProblem(step);
    if (invalidStep !== undefined) {
      return { _tag: "InvalidPlan", reason: "invalid-step", locator, detail: invalidStep };
    }
    const seen = observed.get(locatorKey(locator));
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
