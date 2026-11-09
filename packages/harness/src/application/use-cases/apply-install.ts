import { AgentKitError, definedFields } from "@rivus/agent-kit-catalog/public";
import { PlatformService } from "@rivus/agent-kit-platform/effect";
import * as Effect from "effect/Effect";

import { type ArtifactLocatorSnapshot, locatorKey } from "../../domain/install-plan/value-objects/artifact-locator.js";
import { type PlanAction, type Removal, PlanStep } from "../../domain/install-plan/value-objects/plan-step.js";
import { planClosedError, type PlanStale } from "../../domain/install-plan/errors/plan-stale.js";
import { registrationCommands } from "../../domain/install-plan/services/registration-commands.js";
import type { ArtifactContent, ContentHash } from "../../domain/ledger/value-objects/content-hash.js";
import type { LedgerEntry } from "../../domain/ledger/entities/ledger-entry.js";
import type { LedgerEvent } from "../../domain/ledger/aggregates/ledger.js";
import type { PendingOperation, StepOutcome } from "../../domain/ledger/entities/pending-operation.js";
import type { PendingOperations } from "../../domain/ledger/errors/pending-operations.js";
import type { PreImage } from "../../domain/ledger/value-objects/pre-image.js";
import type { ApplyFailed, TargetChanged } from "../errors.js";
import { fromResult } from "../services/from-result.js";
import { type InstallPlan, type PlanRecord, recordOf } from "../services/install-plan-handle.js";
import {
  DEFAULT_LOCK_WAIT_MS,
  type LedgerLockError,
  type LedgerReadError,
  type LoadedLedger,
  lockLedger,
  nowIso,
  saveLedger
} from "../services/ledger-session.js";
import { observe, type RegistrationLookup, registrationLookup, registrationState } from "../services/observe.js";
import type { HarnessServices } from "./plan-install.js";
import {
  AgentCli,
  type AgentCliFailure,
  ArtifactFiles,
  type ArtifactFailure,
  ExternalOwner,
  LedgerRepository,
  type LedgerRepositoryFailure,
  type RevisionConflict
} from "../ports.js";
import { TOOL_VERSION } from "../services/tool-version.js";

const parentOf = (path: string): string => path.slice(0, Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\")));

export interface ApplyInstallOptions {
  /** How long to wait for another holder of the LedgerLock; 10 s by default. Interrupting stops the wait. */
  readonly lockWaitMs?: number;
}

export interface AppliedStep {
  readonly locator: ArtifactLocatorSnapshot;
  readonly action: PlanAction;
  readonly removal?: Removal;
  /** The step's pre-image, when it captured one, so a legacy removal can be undone from it. */
  readonly preImage?: PreImage;
}

export interface ApplyReport {
  readonly planId: string;
  /** The ledger revision after the plan's outcomes were recorded. */
  readonly ledgerRevision: number;
  readonly steps: readonly AppliedStep[];
  readonly events: readonly LedgerEvent[];
}

export type ApplyInstallError =
  | PlanStale
  | PendingOperations
  | TargetChanged
  | ApplyFailed
  | ArtifactFailure
  | LedgerReadError
  | LedgerLockError
  | RevisionConflict;

/** The hash at the step's target now, compared with what the plan expected there. */
function checkPrecondition(
  step: PlanStep,
  entry: LedgerEntry | undefined,
  registrations: RegistrationLookup
): Effect.Effect<
  { readonly matches: boolean; readonly actual?: ContentHash; readonly content?: ArtifactContent },
  ArtifactFailure,
  ArtifactFiles | PlatformService
> {
  return Effect.gen(function* () {
    const found = "ownedAt" in step.precondition ? undefined : yield* observe(step.locator, registrations);
    const matches = step.preconditionHolds({ entry, observed: found });
    if (found === undefined || found.content === undefined) {
      return definedFields({ matches, actual: found?.hash });
    }
    return { matches, actual: found.hash, content: found.content };
  });
}

/** Changes the target as the step says; steps that only change the ledger do nothing here. */
function executeStep(
  record: PlanRecord,
  step: PlanStep,
  op: PendingOperation | undefined,
  entry: LedgerEntry | undefined
): Effect.Effect<
  void,
  ArtifactFailure | AgentCliFailure | LedgerRepositoryFailure,
  ArtifactFiles | AgentCli | LedgerRepository | PlatformService
> {
  return Effect.gen(function* () {
    if (!step.touchesDisk()) {
      return;
    }
    const { locator } = step;
    if (locator.kind === "cli-registration") {
      const commands = registrationCommands(step.toSnapshot(), entry);
      if (commands === undefined) {
        throw new AgentKitError("invalid-plan", `Step ${locatorKey(locator)} has no agent to run its command line`);
      }
      // A restore-pre-image leaves the adopted registration in place; no command line and no symlink guard apply.
      if (commands.purposes.length === 0) {
        return;
      }
      const { agent } = commands;
      const registrations = registrationLookup(record.adapters, record.context);
      const checked = () =>
        Effect.gen(function* () {
          const state = yield* registrationState(locator, registrations);
          if (state.symlinkTarget !== undefined) {
            return yield* Effect.fail({
              _tag: "ArtifactIoFailure" as const,
              path: locator.path,
              operation: "write" as const,
              message: "Refusing a command-line mutation through a symlinked registration target"
            });
          }
          return state.registration;
        });
      const registration = yield* checked();
      if (registration === undefined) {
        throw new AgentKitError("capability-unsupported", `No command line registers ${locatorKey(locator)}`);
      }
      const cli = yield* AgentCli;
      for (const purpose of commands.purposes) {
        if (purpose === "unregister") {
          const { recorded, unregister } = registration;
          // A plain removal without the agent's command line removes what it would: its records and copies. A
          // re-registration still needs the command line, so mutating by hand before a register that cannot run
          // would leave the registration half-done.
          if (commands.purposes.length === 1 && recorded !== undefined && !(yield* cli.available(unregister.command))) {
            const files = yield* ArtifactFiles;
            for (const recordedEntry of recorded.entries) {
              yield* files.remove(recordedEntry);
            }
            for (const copy of recorded.copies) {
              yield* files.remove({ kind: "dir", path: copy });
            }
            return;
          }
          yield* checked();
          yield* cli.run({ agent, ...unregister });
        } else {
          yield* checked();
          yield* cli.run({ agent, ...registration.register });
        }
      }
      return;
    }
    const files = yield* ArtifactFiles;
    if (step.action !== "remove") {
      if (step.desired === undefined) {
        throw new AgentKitError("invalid-plan", `Step ${locatorKey(locator)} writes without desired content`);
      }
      return yield* files.write(locator, step.desired.content);
    }
    if (step.removal === "restore-pre-image") {
      if (op?.preImage?.existed !== true) {
        throw new AgentKitError("invalid-plan", `Step ${locatorKey(locator)} restores without a pre-image`);
      }
      return yield* files.write(
        locator,
        yield* (yield* LedgerRepository).getPreImage(record.scope, op.preImage.blobRef)
      );
    }
    return yield* files.remove(locator, {
      removeEmptyFile:
        (locator.kind === "json-entry" || locator.kind === "toml-entry") && entry?.createdConfigFile === true
    });
  });
}

type StepResult =
  | { readonly status: "done"; readonly loaded: LoadedLedger }
  | { readonly status: "skipped"; readonly loaded: LoadedLedger; readonly failure: TargetChanged }
  | { readonly status: "failed"; readonly loaded: LoadedLedger; readonly failure: ApplyFailed };

/**
 * Applies a plan while the caller holds the scope's LedgerLock and `loaded` is the ledger read under it: re-checks
 * every precondition before writing anything, keeps the pre-images the plan asks for, records every step as pending,
 * then runs the steps in order. Each step re-checks its precondition, writes and records its outcome in one
 * uninterruptible region, so interruption lands only between steps and leaves the steps that did not run pending for
 * the next holder to probe. A step that finds its target changed, or fails, ends the apply; nothing is retried.
 */
export function applyLocked(
  record: PlanRecord,
  start: LoadedLedger
): Effect.Effect<
  ApplyReport,
  ApplyInstallError,
  ArtifactFiles | AgentCli | LedgerRepository | ExternalOwner | PlatformService
> {
  return Effect.gen(function* () {
    const plan = record.aggregate;
    const { planId, steps } = plan;
    const ledger = start.ledger;
    const stale = plan.staleAgainst(ledger);
    if (stale !== undefined) {
      return yield* Effect.fail(stale satisfies PlanStale);
    }
    const repository = yield* LedgerRepository;
    const files = yield* ArtifactFiles;
    const registrations = registrationLookup(record.adapters, record.context);
    const preImages: Record<string, PreImage> = {};
    const createdDirs = new Set<string>();
    const configPaths = new Set(
      steps
        .filter((step) => step.locator.kind === "json-entry" || step.locator.kind === "toml-entry")
        .map((step) => step.locator.path)
    );
    const createdConfigFiles = new Set<string>();
    const revokedConfigFiles = new Set<string>();
    for (const entry of ledger.entries()) {
      const { locator } = entry;
      if (
        entry.createdConfigFile !== true ||
        (locator.kind !== "json-entry" && locator.kind !== "toml-entry") ||
        !configPaths.has(locator.path) ||
        createdConfigFiles.has(locator.path)
      ) {
        continue;
      }
      // Creation evidence is optional, so failures here count as non-matches, including for this owner's entries.
      // Required precondition reads still propagate failures on the operation's targets.
      const found = yield* Effect.match(observe(locator, registrations), {
        onFailure: () => undefined,
        onSuccess: (observed) => observed
      });
      if (found?.hash === entry.contentHash && found.symlinkTarget === undefined) {
        createdConfigFiles.add(locator.path);
        revokedConfigFiles.delete(locator.path);
      } else {
        revokedConfigFiles.add(locator.path);
      }
    }
    const absentConfigFiles = new Set<string>();
    const inspectedConfigFiles = new Set<string>();
    // What each writing step's recursive mkdir is missing, observed before anything is written: the ancestors the
    // install will have created within the resolved installation roots. Only these, once the step that creates them
    // has run, become ledger claims; a step that never runs, or an apply that dies first, stays unclaimed.
    const platform = yield* PlatformService;
    const statNow = (path: string) => Effect.tryPromise(() => platform.fs.stat(path));
    const roots = plan.toSnapshot().target.roots;
    const withinRoots = (dir: string): boolean => roots.some((root) => dir === root || dir.startsWith(`${root}/`));
    const missingAncestors = new Map<string, string[]>();
    for (const step of steps) {
      if (step.action === "remove" || !step.touchesDisk()) {
        continue;
      }
      const missing: string[] = [];
      for (let dir = parentOf(step.locator.path); withinRoots(dir); dir = parentOf(dir)) {
        const seen = yield* Effect.match(statNow(dir), {
          onFailure: () => null,
          onSuccess: (stat) => stat
        });
        if (seen === null) {
          // The stat failed, so whether this directory exists is unknown: the walk stops, and nothing unknown is
          // claimed — the entries the walk already proved missing stay, since their claims only land when the
          // step that creates them succeeds.
          break;
        }
        if (seen !== undefined) {
          // The directory and every ancestor above it were already there.
          break;
        }
        missing.push(dir);
      }
      if (missing.length > 0) {
        missingAncestors.set(locatorKey(step.locator), missing);
      }
    }
    for (const step of steps) {
      const check = yield* checkPrecondition(step, ledger.entry(step.locator), registrations);
      if (!check.matches) {
        return yield* Effect.fail(
          definedFields({
            _tag: "TargetChanged",
            planId,
            locator: step.locator,
            expected: step.precondition,
            actual: check.actual,
            completed: 0
          } satisfies TargetChanged)
        );
      }
      if (step.capturePreImage && check.actual !== undefined && check.content !== undefined) {
        const blobRef = yield* repository.putPreImage(record.scope, check.content);
        preImages[locatorKey(step.locator)] = { existed: true, hash: check.actual, blobRef };
      }
      const { locator } = step;
      if (
        (locator.kind === "json-entry" || locator.kind === "toml-entry") &&
        step.action !== "remove" &&
        step.touchesDisk() &&
        !inspectedConfigFiles.has(locator.path)
      ) {
        inspectedConfigFiles.add(locator.path);
        if ((yield* files.read({ kind: "file", path: locator.path })) === undefined) {
          absentConfigFiles.add(locator.path);
          createdConfigFiles.add(locator.path);
        }
      }
    }
    const begun = yield* fromResult(
      ledger.begin(plan, {
        at: yield* nowIso,
        toolVersion: TOOL_VERSION,
        preImages,
        createdConfigFiles: [...createdConfigFiles],
        revokedConfigFiles: [...revokedConfigFiles]
      })
    );
    let loaded = yield* Effect.uninterruptible(saveLedger(record.scope, start, begun));
    record.aggregate = (yield* fromResult(plan.markApplied())).state;

    const events: LedgerEvent[] = [];
    const applied: AppliedStep[] = [];
    const recordOutcome = (outcome: StepOutcome, from: LoadedLedger) =>
      Effect.gen(function* () {
        const transition = from.ledger.complete([outcome], { at: yield* nowIso });
        events.push(...transition.events);
        return yield* saveLedger(record.scope, from, transition);
      });

    for (const [index, step] of steps.entries()) {
      const result: StepResult = yield* Effect.uninterruptible(
        Effect.gen(function* () {
          const entry = loaded.ledger.entry(step.locator);
          const op = loaded.ledger.pending.find((pending) => locatorKey(pending.locator) === locatorKey(step.locator));
          const check = yield* checkPrecondition(step, start.ledger.entry(step.locator), registrations);
          // Entry absence alone does not detect a pre-existing empty file introduced after pending was saved.
          const createsConfigFile =
            step.action !== "remove" && step.touchesDisk() && absentConfigFiles.has(step.locator.path);
          const fileAppeared =
            createsConfigFile && (yield* files.read({ kind: "file", path: step.locator.path })) !== undefined;
          if (!check.matches || fileAppeared) {
            const failure: TargetChanged = definedFields({
              _tag: "TargetChanged",
              planId,
              locator: step.locator,
              expected: step.precondition,
              actual: check.actual,
              completed: index
            } satisfies TargetChanged);
            return {
              status: "skipped",
              loaded: yield* recordOutcome({ locator: step.locator, status: "skipped" }, loaded),
              failure
            } as const;
          }
          const error = yield* Effect.match(executeStep(record, step, op, entry), {
            onFailure: (cause) => cause,
            onSuccess: () => undefined
          });
          if (error !== undefined) {
            const failure: ApplyFailed = {
              _tag: "ApplyFailed",
              planId,
              locator: step.locator,
              cause: error,
              completed: index
            };
            return {
              status: "failed",
              loaded: yield* recordOutcome({ locator: step.locator, status: "failed" }, loaded),
              failure
            } as const;
          }
          if (createsConfigFile) {
            absentConfigFiles.delete(step.locator.path);
          }
          return {
            status: "done",
            loaded: yield* recordOutcome({ locator: step.locator, status: "done" }, loaded)
          } as const;
        })
      );
      loaded = result.loaded;
      if (result.status !== "done") {
        // The steps after this one did not start, so they keep their old records.
        const rest = steps
          .slice(index + 1)
          .map((later): StepOutcome => ({ locator: later.locator, status: "skipped" }));
        if (rest.length > 0) {
          const transition = loaded.ledger.complete(rest, { at: yield* nowIso });
          loaded = yield* Effect.uninterruptible(saveLedger(record.scope, loaded, transition));
        }
        return yield* Effect.fail(result.failure);
      }
      const key = locatorKey(step.locator);
      applied.push(
        definedFields({
          locator: step.locator,
          action: step.action,
          removal: step.removal,
          preImage: preImages[key]
        })
      );
      // The step wrote, so the ancestors it was missing exist now: their creation is certain, and they become
      // claims with the save below. An apply that fails or dies before it claims nothing, however much it created.
      for (const dir of missingAncestors.get(key) ?? []) {
        createdDirs.add(dir);
      }
    }
    // Directory claims and cleanup, in one ledger save: the ancestors this apply positively created, and the
    // release of the claimed ancestors this apply emptied, per owner, so an uninstall removes a directory only
    // after its last owner's use ends. The walk goes upward through positively claimed directories only and stops
    // at pre-existing, unknown, nonempty, symlinked or externally managed paths; the removal itself is
    // nonrecursive and refuses a nonempty directory.
    const releasedDirs = new Set<string>();
    const removals = applied.filter((step) => step.action === "remove");
    if (removals.length > 0) {
      const owner = plan.bundle.owner;
      const directories = loaded.ledger.toSnapshot().directories ?? {};
      const chains = removals.map((step) => {
        const chain: { readonly path: string; readonly last: boolean; readonly claimed: boolean }[] = [];
        for (let dir = parentOf(step.locator.path); ; dir = parentOf(dir)) {
          const claim = directories[dir];
          if (claim === undefined) {
            break;
          }
          chain.push({ path: dir, last: claim.owners.length === 1, claimed: claim.owners.includes(owner) });
          if (claim.owners.length > 1) {
            break;
          }
        }
        return chain;
      });
      const managed = yield* (yield* ExternalOwner).managedPaths(chains.flat().map((dir) => dir.path));
      for (const chain of chains) {
        for (const { path, last, claimed } of chain) {
          if (!last && !claimed) {
            // The claim names other owners only: the directory stays, and this apply releases nothing of it.
            break;
          }
          if (!last) {
            // Other owners still use the directory: this owner's claim ends, the directory stays.
            releasedDirs.add(path);
            break;
          }
          if (managed.has(path)) {
            break;
          }
          const found = yield* Effect.match(statNow(path), {
            onFailure: () => null,
            onSuccess: (stat) => stat
          });
          if (found === null) {
            // The stat failed, so the directory's state is unknown: stop the chain without releasing its claim,
            // rather than failing the apply after its steps have been saved.
            break;
          }
          if (found === undefined) {
            // Gone already, by an interrupted cleanup: release the claim and keep walking.
            releasedDirs.add(path);
            continue;
          }
          if (found.kind !== "dir") {
            break;
          }
          // A nonempty directory refuses the nonrecursive removal: its claim stays for a later cleanup.
          const removed = yield* Effect.match(
            Effect.tryPromise(() => platform.fs.remove(path)),
            {
              onFailure: () => undefined,
              onSuccess: () => true as const
            }
          );
          if (removed !== true) {
            break;
          }
          releasedDirs.add(path);
        }
      }
    }
    if (createdDirs.size > 0 || releasedDirs.size > 0) {
      const transition = loaded.ledger.updateDirectories(
        plan.bundle.owner,
        [...createdDirs],
        [...releasedDirs].toSorted()
      );
      if (transition.state !== loaded.ledger) {
        loaded = yield* saveLedger(record.scope, loaded, transition);
      }
    }
    return { planId, ledgerRevision: loaded.ledger.revision, steps: applied, events };
  });
}

/**
 * Applies a plan from `planInstall` once. Under the scope's LedgerLock it probes what an earlier holder left pending,
 * refuses the plan when the ledger moved on since it was built or when any target no longer holds what the plan saw
 * (nothing is written then), and otherwise runs the steps with the guarantees of `applyLocked`. The lock is released
 * only after the step in flight finished and its outcome was recorded.
 *
 * Writes into files that agents and other tools share are not compare-and-swap: a writer that does not take the
 * LedgerLock can still change a file between the re-check and the write, and that change is lost without a trace.
 */
export function applyInstall(
  plan: InstallPlan,
  options: ApplyInstallOptions = {}
): Effect.Effect<ApplyReport, ApplyInstallError, HarnessServices> {
  return Effect.scoped(
    Effect.gen(function* () {
      const record = yield* Effect.sync(() => recordOf(plan));
      const { basedOn, planId, status } = record.aggregate;
      const closed = planClosedError({ planId, status, basedOn });
      if (closed !== undefined) {
        return yield* Effect.fail(closed satisfies PlanStale);
      }
      const { loaded } = yield* lockLedger(record.scope, {
        waitMs: options.lockWaitMs ?? DEFAULT_LOCK_WAIT_MS,
        lineage: basedOn.ledgerLineage,
        registrations: registrationLookup(record.adapters, record.context)
      });
      return yield* applyLocked(record, loaded);
    })
  );
}
