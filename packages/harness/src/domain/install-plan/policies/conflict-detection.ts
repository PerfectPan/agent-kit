import type { CodingAgentId } from "@rivus/agent-kit-catalog";

import type { Owner } from "../../bundle/value-objects/owner.js";
import type { Strategy } from "../../bundle/value-objects/strategy.js";
import { holds, release, unionAgents } from "../../ledger/policies/ownership.js";
import { threeWayVerify } from "../../ledger/policies/three-way-verify.js";
import type { ArtifactContent, ContentHash } from "../../ledger/value-objects/content-hash.js";
import type { LedgerEntry } from "../../ledger/value-objects/ledger-entry.js";
import type { ArtifactLocator } from "../value-objects/artifact-locator.js";
import { CONFLICT_CHOICES, type Conflict, type ConflictChoice } from "../value-objects/conflict.js";
import type { ObservedArtifact } from "../value-objects/observed-artifact.js";
import { type PlanStep, type StepNote, touchesDisk } from "../value-objects/plan-step.js";
import type { Precondition } from "../value-objects/precondition.js";

/** What every agent of the plan wants at one locator. */
export interface DesiredState {
  readonly locator: ArtifactLocator;
  readonly content: ArtifactContent;
  readonly hash: ContentHash;
  readonly strategy: Strategy;
  readonly agents: readonly CodingAgentId[];
}

/** The three views of one locator, and the owner's choice for it. */
export interface LocatorState {
  readonly owner: Owner;
  /** The agents the plan covers. */
  readonly agents: readonly CodingAgentId[];
  readonly desired?: DesiredState;
  readonly entry?: LedgerEntry;
  readonly observed?: ObservedArtifact;
  /** The observed content is what an older version of the owner installed without a ledger. */
  readonly legacy: boolean;
  readonly choice?: ConflictChoice;
  /**
   * The ForeignOwner that manages the locator's path, whether or not anything is there yet (an entry's path is its
   * file); `observed.managedBy` counts too.
   */
  readonly managedBy?: string;
  /**
   * The symlink target of the locator's path, whether or not the Artifact is there yet (an entry's path is its file);
   * `observed.symlinkTarget` counts too.
   */
  readonly symlinkTarget?: string;
  /** The plan installs Artifacts of the owner, which what an older version left would run next to. */
  readonly replacing?: boolean;
}

const preconditionOf = (observed: ObservedArtifact | undefined): Precondition =>
  observed === undefined ? { absent: true } : { hash: observed.hash };

/** A conflict step, or the step its choice resolves it to when the choice is one CONFLICT_CHOICES allows. */
function conflictStep(
  base: PlanStep,
  conflict: Conflict,
  choice: ConflictChoice | undefined,
  resolve: (choice: ConflictChoice) => Partial<PlanStep>
): PlanStep {
  return choice !== undefined && CONFLICT_CHOICES[conflict].includes(choice)
    ? { ...base, ...resolve(choice), conflict, choice }
    : { ...base, action: "conflict", conflict };
}

/**
 * The choices that resolve one conflicting step (see CONFLICT_CHOICES): `adopt` resolves a symlinked target only for
 * content nobody recorded that needs no write, which is the only case `guardDisk` lets it through.
 */
export function conflictChoices(step: PlanStep, entry: LedgerEntry | undefined): readonly ConflictChoice[] {
  if (step.conflict === "symlinked-target") {
    const matching =
      step.desired !== undefined && "hash" in step.precondition && step.precondition.hash === step.desired.hash;
    return matching && entry === undefined ? ["adopt"] : [];
  }
  return step.conflict === undefined ? [] : CONFLICT_CHOICES[step.conflict];
}

/**
 * Keeps harness from writing or deleting at a path a ForeignOwner manages, or through a symlink at the Artifact. A
 * write there, and any other conflict there (every way to resolve it writes), is a conflict no choice resolves. A
 * removal of an owned Artifact there never blocks, so uninstall always converges: it is kept and its record dropped,
 * with a note. Any blocked removal conflicts when the plan installs a replacement, since the retained Artifact may
 * run next to it. A legacy Artifact there is left with a note when uninstalling. Taking unrecorded content
 * behind a symlink as the owner's needs an explicit `adopt`. Steps that leave the disk alone otherwise pass.
 */
function guardDisk(
  step: PlanStep,
  state: Pick<LocatorState, "observed" | "entry" | "choice" | "managedBy" | "symlinkTarget" | "replacing">
): PlanStep {
  const { observed, entry, choice } = state;
  const foreign = state;
  const note: StepNote | undefined =
    (foreign.managedBy ?? observed?.managedBy) !== undefined
      ? "dotfiles-managed"
      : (foreign.symlinkTarget ?? observed?.symlinkTarget) !== undefined && step.locator.kind !== "symlink"
        ? "symlinked-target"
        : undefined;
  if (note === undefined) {
    return step;
  }
  const { choice: _choice, conflict: _conflict, removal: _removal, ...plain } = step;
  if (step.action === "remove") {
    if (!touchesDisk(step)) {
      return step;
    }
    if (state.replacing === true) {
      return { ...plain, action: "conflict", conflict: note };
    }
    if (step.legacy === true) {
      return { ...plain, action: "noop", note };
    }
    return { ...plain, removal: "keep", note };
  }
  if (step.action === "conflict" || touchesDisk(step)) {
    return { ...plain, action: "conflict", conflict: note };
  }
  if (note === "symlinked-target" && step.action === "adopt" && entry === undefined) {
    return choice === "adopt" ? { ...plain, conflict: note, choice } : { ...plain, action: "conflict", conflict: note };
  }
  return step;
}

function installStep(state: LocatorState, desired: DesiredState): PlanStep {
  const { owner, entry, observed, choice, legacy } = state;
  const shared = entry !== undefined && entry.owners.some((other) => other !== owner);
  const base: PlanStep = {
    locator: desired.locator,
    action: "noop",
    agents: unionAgents(
      entry === undefined ? [] : shared ? entry.agents : entry.agents.filter((agent) => !state.agents.includes(agent)),
      desired.agents
    ),
    precondition: preconditionOf(observed),
    desired: { hash: desired.hash, content: desired.content },
    strategy: desired.strategy,
    capturePreImage: false
  };
  const write = { action: observed === undefined ? "create" : "update" } as const;
  if (entry !== undefined && shared) {
    // Owners share an Artifact only while they want its recorded content and it is on disk to join; anything else
    // takes it from the others, which only a force does.
    const joinable = desired.hash === entry.contentHash && (holds(entry, owner) || observed?.hash === desired.hash);
    if (!joinable) {
      // A takeover of different content leaves the owner alone with it, so only its own agents use it.
      const agents = desired.hash === entry.contentHash ? base.agents : desired.agents;
      return conflictStep(base, "other-owner", choice, () => ({ ...write, agents }));
    }
    if (!holds(entry, owner)) {
      return { ...base, action: "adopt" };
    }
  }
  switch (threeWayVerify({ ledger: entry?.contentHash, actual: observed?.hash, desired: desired.hash })) {
    case "in-sync":
    case "ledger-behind":
      return base;
    case "outdated":
      return { ...base, action: "update", drift: "outdated" };
    case "user-modified":
      return conflictStep({ ...base, drift: "user-modified" }, "user-modified", choice, () => write);
    case "deleted-externally":
      return { ...base, action: "create", drift: "deleted-externally" };
    case "missing":
      return { ...base, action: "create" };
    case "adoptable":
      return legacy
        ? { ...base, action: "adopt", drift: "adoptable", legacy: true }
        : { ...base, action: "adopt", drift: "adoptable", capturePreImage: true };
    case "unmanaged":
      return legacy
        ? { ...base, action: "adopt", legacy: true }
        : conflictStep(base, "unmanaged-exists", choice, (chosen) => ({
            action: "adopt",
            capturePreImage: chosen === "backup"
          }));
  }
}

function removalStep(state: LocatorState): PlanStep | undefined {
  const { owner, entry, observed, choice, legacy } = state;
  if (entry === undefined) {
    return observed !== undefined && legacy
      ? {
          locator: observed.locator,
          action: "remove",
          agents: [],
          precondition: preconditionOf(observed),
          capturePreImage: false,
          removal: "delete",
          legacy: true
        }
      : undefined;
  }
  if (!holds(entry, owner) || !entry.agents.some((agent) => state.agents.includes(agent))) {
    return undefined;
  }
  const { removal, agents } = release(entry, owner, state.agents);
  const base: PlanStep = {
    locator: entry.locator,
    action: "remove",
    agents,
    removal,
    capturePreImage: false,
    precondition: { ownedAt: entry.entryRevision }
  };
  if (removal === "release") {
    return base;
  }
  const status = threeWayVerify({ ledger: entry.contentHash, actual: observed?.hash });
  const precondition = preconditionOf(observed);
  if (status === "user-modified") {
    if (state.replacing === true && entry.locator.memberIn === "hook-group" && choice !== "force") {
      return { ...base, precondition, action: "conflict", drift: status, conflict: status };
    }
    // The user's change stays on disk as theirs and the owner lets go of it; only an explicit force removes it.
    return choice === "force"
      ? { ...base, precondition, drift: status, conflict: status, choice }
      : { ...base, removal: "keep", precondition, drift: status };
  }
  return status === "deleted-externally" ? { ...base, precondition, drift: status } : { ...base, precondition };
}

/**
 * The step for one locator, or none when the plan leaves it alone. An owner's Artifact that the bundle still wants is
 * created, updated, adopted or kept according to three-way verify; one it no longer wants for the plan's agents is
 * removed, released while other owners or agents still use it, or left to the user who changed it. What an older
 * version of the owner left without a ledger is replaced or removed. Anything else in the way is a conflict unless an
 * allowed choice resolves it, and nothing is written or deleted at a dotfiles-managed or symlinked path (`guardDisk`).
 */
export function planStep(state: LocatorState): PlanStep | undefined {
  const step = state.desired === undefined ? removalStep(state) : installStep(state, state.desired);
  return step === undefined ? undefined : guardDisk(step, state);
}
