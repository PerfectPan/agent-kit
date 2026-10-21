import { err, type Result, type CodingAgentId } from "@rivus/agent-kit-catalog/public";
import { type BundleSnapshot } from "../../bundle/value-objects/bundle.js";
import { type HookDialects } from "../../lifecycle/spi/hook-dialect.js";
import { type PendingOperations } from "../../ledger/errors/pending-operations.js";
import { Ledger } from "../../ledger/aggregates/ledger.js";
import { InstallPlan } from "../aggregates/install-plan.js";
import { type InvalidPlan } from "../errors/invalid-plan.js";
import { type PlanConflict } from "../errors/plan-conflict.js";
import { type PlanStale } from "../errors/plan-stale.js";
import {
  type ForeignHookObservation,
  legacyTreatment,
  protectedLegacy,
  protectedReplacement,
  retainedForeignConflict
} from "../services/legacy-ownership.js";
import { type LocatorKey, locatorKey, type ArtifactLocatorSnapshot } from "../value-objects/artifact-locator.js";
import { type ConflictChoice, Conflict, type ConflictSnapshot } from "../value-objects/conflict.js";
import { type DesiredArtifact } from "../spi/desired-artifact.js";
import { type InstallTargetSnapshot } from "../value-objects/install-target.js";
import { type ObservedArtifact } from "../spi/observed-artifact.js";
import { PlanStep, type PlanStepSnapshot, type StepNote } from "../value-objects/plan-step.js";
import { type TrustPrompt } from "../value-objects/trust-prompt.js";
import { type OwnerSnapshot } from "../../bundle/value-objects/owner.js";
import { type Strategy } from "../../bundle/spi/strategy.js";
import { threeWayVerify } from "../../ledger/services/three-way-verify.js";
import { type ArtifactContent, type ContentHash } from "../../ledger/value-objects/content-hash.js";
import { type LedgerEntry } from "../../ledger/entities/ledger-entry.js";
import { type PreconditionSnapshot } from "../value-objects/precondition.js";

export interface PlanRequest {
  readonly legacyTexts: ReadonlyMap<ObservedArtifact, string>;
  /** Chosen by the caller, such as a random UUID. */
  readonly planId: string;
  /** Checked with `Bundle.restore`. */
  readonly bundle: BundleSnapshot;
  readonly target: InstallTargetSnapshot;
  /**
   * The bundle's Artifacts as the target agents' strategies render them. Whatever the owner holds for these agents
   * and no longer desires is removed, so an uninstall is a plan with nothing desired.
   */
  readonly desired: readonly DesiredArtifact[];
  /** Explicit choices for conflicting locators. */
  readonly choices?: Readonly<Record<LocatorKey, ConflictChoice>>;
  /**
   * Paths a ForeignOwner such as chezmoi manages, with its name, whether or not anything is at them yet: an entry
   * that is not in its file yet still must not be written into a managed file.
   */
  readonly managedPaths?: Readonly<Record<string, string>>;
  /**
   * Paths that are symlinks, with their targets, whether or not the Artifact is in them yet: an entry must not be
   * written into a linked file, which an atomic write would replace with a regular one.
   */
  readonly linkedPaths?: Readonly<Record<string, string>>;
  /**
   * Hooks observed in foreign files the selected runners execute (see `foreignHookFiles`), each with its runner and
   * the event it fires it as: one the owner tracks and must keep for another consumer is an unresolvable conflict.
   */
  readonly foreignHooks?: readonly ForeignHookObservation[];
  /** The selected agents' dialects, used to tell a hook event from a runner's alias of it. */
  readonly dialects?: HookDialects;
}

/** What every agent of the plan wants at one locator. */
interface DesiredState {
  readonly locator: ArtifactLocatorSnapshot;
  readonly content: ArtifactContent;
  readonly hash: ContentHash;
  readonly strategy: Strategy;
  readonly agents: readonly CodingAgentId[];
}

/** The three views of one locator, and the owner's choice for it. */
interface LocatorState {
  readonly owner: OwnerSnapshot;
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

const preconditionOf = (observed: ObservedArtifact | undefined): PreconditionSnapshot =>
  observed === undefined ? { absent: true } : { hash: observed.hash };

/** A conflict step, or the step its choice resolves it to when the choice is one CONFLICT_CHOICES allows. */
function conflictStep(
  base: PlanStepSnapshot,
  conflict: ConflictSnapshot,
  choice: ConflictChoice | undefined,
  resolve: (choice: ConflictChoice) => Partial<PlanStepSnapshot>
): PlanStepSnapshot {
  return choice !== undefined && Conflict.restore(conflict).choices().includes(choice)
    ? { ...base, ...resolve(choice), conflict, choice }
    : { ...base, action: "conflict", conflict };
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
  step: PlanStepSnapshot,
  state: Pick<LocatorState, "observed" | "entry" | "choice" | "managedBy" | "symlinkTarget" | "replacing">
): PlanStepSnapshot {
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
    if (!PlanStep.touchesDisk(step)) {
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
  if (step.action === "conflict" || PlanStep.touchesDisk(step)) {
    return { ...plain, action: "conflict", conflict: note };
  }
  if (note === "symlinked-target" && step.action === "adopt" && entry === undefined) {
    return choice === "adopt" ? { ...plain, conflict: note, choice } : { ...plain, action: "conflict", conflict: note };
  }
  return step;
}

function installStep(state: LocatorState, desired: DesiredState): PlanStepSnapshot {
  const { owner, entry, observed, choice, legacy } = state;
  const shared = entry !== undefined && entry.owners.some((other) => other !== owner);
  const base: PlanStepSnapshot = {
    locator: desired.locator,
    action: "noop",
    agents: Ledger.unionAgents(
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
    const joinable = desired.hash === entry.contentHash && (entry.heldBy(owner) || observed?.hash === desired.hash);
    if (!joinable) {
      // A takeover of different content leaves the owner alone with it, so only its own agents use it.
      const agents = desired.hash === entry.contentHash ? base.agents : desired.agents;
      return conflictStep(base, "other-owner", choice, () => ({ ...write, agents }));
    }
    if (!entry.heldBy(owner)) {
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

function removalStep(state: LocatorState): PlanStepSnapshot | undefined {
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
  if (!entry.heldBy(owner, state.agents)) {
    return undefined;
  }
  const { removal, agents } = entry.release(owner, state.agents);
  const base: PlanStepSnapshot = {
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
function planStep(state: LocatorState): PlanStepSnapshot | undefined {
  const step = state.desired === undefined ? removalStep(state) : installStep(state, state.desired);
  return step === undefined ? undefined : guardDisk(step, state);
}

/** Whether the step puts new content at its target, which is what makes an agent ask for trust again. */
const writesContent = (step: PlanStepSnapshot): boolean => step.action !== "remove" && PlanStep.touchesDisk(step);

/**
 * Builds the plan that brings the target agents from the ledger and the observed files to what the request desires,
 * without IO: `observed` describes what the application found at every desired locator, at every locator the owner
 * holds for these agents, and wherever an older version of the owner may have installed something.
 */
export function buildInstallPlan(
  request: PlanRequest,
  ledger: Ledger,
  observed: readonly ObservedArtifact[]
): Result<InstallPlan, PendingOperations | PlanStale | InvalidPlan | PlanConflict> {
  const { bundle, target } = request;
  const desired = new Map<LocatorKey, { readonly state: DesiredState; readonly trust: readonly TrustPrompt[] }>();
  for (const artifact of request.desired) {
    const key = locatorKey(artifact.locator);
    const known = desired.get(key);
    if (
      known !== undefined &&
      (known.state.hash !== artifact.hash || known.state.locator.kind !== artifact.locator.kind)
    ) {
      return err({ _tag: "InvalidPlan", reason: "conflicting-desired", locator: artifact.locator });
    }
    const trust: TrustPrompt[] =
      artifact.trust === undefined ? [] : [{ agent: artifact.agent, kind: artifact.trust, locator: artifact.locator }];
    desired.set(key, {
      state: {
        locator: artifact.locator,
        content: artifact.content,
        hash: artifact.hash,
        strategy: known?.state.strategy ?? artifact.strategy,
        agents: Ledger.unionAgents(known?.state.agents ?? [], [artifact.agent])
      },
      trust: [...(known?.trust ?? []), ...trust]
    });
  }
  const markers = bundle.legacyMarkers ?? [];
  const found = new Map(observed.map((artifact) => [locatorKey(artifact.locator), artifact]));
  const entries = new Map(ledger.entries().map((entry) => [locatorKey(entry.locator), entry]));
  // What the user kept on an earlier removal is theirs, even when it still carries a legacy marker: `legacyTreatment`
  // reads it as protected, so only a replaceable legacy Artifact names the step legacy.
  const isLegacy = (key: LocatorKey): boolean => {
    const seen = found.get(key);
    return (
      seen !== undefined &&
      legacyTreatment(seen, bundle.owner, markers, ledger, observed, request.legacyTexts.get(seen)) === "replace"
    );
  };
  const preservedHooks = observed.filter(
    (seen) =>
      request.desired.length > 0 &&
      seen.locator.memberIn === "hook-group" &&
      !entries.has(locatorKey(seen.locator)) &&
      protectedLegacy(seen.locator, bundle.owner, ledger, observed) &&
      protectedReplacement(seen, bundle, target.agents, ledger, observed, request.legacyTexts.get(seen))
  );
  const preserved: PlanConflict["conflicts"] = preservedHooks.map((seen) => ({
    step: {
      locator: seen.locator,
      action: "conflict",
      conflict: "user-modified",
      agents: [],
      precondition: { hash: seen.hash },
      capturePreImage: false
    },
    choices: []
  }));
  const managed = request.managedPaths ?? {};
  const linked = request.linkedPaths ?? {};
  const at = (paths: Readonly<Record<string, string>>, path: string | undefined): string | undefined =>
    path !== undefined && Object.hasOwn(paths, path) ? paths[path] : undefined;
  const foreignOf = (path: string | undefined) => {
    const managedBy = at(managed, path);
    const symlinkTarget = at(linked, path);
    return {
      ...(managedBy === undefined ? {} : { managedBy }),
      ...(symlinkTarget === undefined ? {} : { symlinkTarget })
    };
  };
  const keys = new Set([...desired.keys(), ...entries.keys(), ...[...found.keys()].filter(isLegacy)]);
  const steps = [...keys].flatMap((key) => {
    const step = planStep({
      owner: bundle.owner,
      agents: target.agents,
      desired: desired.get(key)?.state,
      entry: entries.get(key),
      observed: found.get(key),
      legacy: isLegacy(key),
      choice: request.choices?.[key],
      replacing: request.desired.length > 0,
      ...foreignOf(
        desired.get(key)?.state.locator.path ?? entries.get(key)?.locator.path ?? found.get(key)?.locator.path
      )
    });
    return step === undefined ? [] : [step];
  });
  const draft = {
    planId: request.planId,
    basedOn: { ledgerLineage: ledger.lineage, ledgerRevision: ledger.revision },
    bundle: { owner: bundle.owner, version: bundle.version, digest: bundle.digest },
    target,
    steps,
    expectedTrustPrompts: steps.flatMap((step) =>
      writesContent(step) ? (desired.get(locatorKey(step.locator))?.trust ?? []) : []
    )
  };
  const created = InstallPlan.create(draft, {
    ledger,
    observed,
    legacyMarkers: markers,
    legacyTexts: request.legacyTexts,
    managedPaths: managed,
    linkedPaths: linked
  });
  if (!created.ok && created.error._tag !== "PlanConflict") {
    return created;
  }
  // A hook kept for the user or a ForeignOwner is judged once, as preserved: create also saw it (its content differs
  // from what the bundle wants) and would list the same locator again, as a conflict an adopt or backup could
  // resolve — so its entries at preserved locators are dropped.
  const preservedKeys = new Set(preserved.map(({ step }) => locatorKey(step.locator)));
  const createConflicts = (!created.ok && created.error._tag === "PlanConflict" ? created.error.conflicts : []).filter(
    ({ step }) => !preservedKeys.has(locatorKey(step.locator))
  );
  // A selected runner can execute a tracked foreign hook that this plan must retain for another consumer. Every
  // conflict is judged in one round — the hooks kept for the user or a ForeignOwner, the plan invariants', and the
  // retained foreign ones — so the caller never resolves a first batch to be shown the next.
  const retained = retainedForeignConflict(request.planId, request.foreignHooks ?? [], {
    bundle,
    dialects: request.dialects ?? {},
    ledger,
    steps
  });
  const conflicts = [...preserved, ...createConflicts, ...(retained?.conflicts ?? [])];
  if (conflicts.length > 0) {
    return err({ _tag: "PlanConflict", planId: request.planId, conflicts });
  }
  return created;
}
