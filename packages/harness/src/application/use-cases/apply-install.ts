import { AgentKitError } from "@rivus/agent-kit-catalog";
import type { PlatformService } from "@rivus/agent-kit-platform/effect";
import * as Effect from "effect/Effect";

import {
  type ArtifactLocator,
  locatorKey,
  type PlanAction,
  planClosedError,
  type PlanStale,
  type PlanStep,
  preconditionHolds,
  type Removal,
  registrationCommands,
  touchesDisk
} from "../../domain/install-plan/index.js";
import type {
  ArtifactContent,
  ContentHash,
  LedgerEntry,
  LedgerEvent,
  PendingOperation,
  PendingOperations,
  PreImage,
  StepOutcome
} from "../../domain/ledger/index.js";
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
  LedgerStore,
  type LedgerStoreFailure
} from "../ports.js";
import { TOOL_VERSION } from "../services/tool-version.js";

export interface ApplyInstallOptions {
  /** How long to wait for another holder of the LedgerLock; 10 s by default. Interrupting stops the wait. */
  readonly lockWaitMs?: number;
}

export interface AppliedStep {
  readonly locator: ArtifactLocator;
  readonly action: PlanAction;
  readonly removal?: Removal;
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
  | LedgerLockError;

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
    const matches = preconditionHolds(step, { entry, observed: found });
    if (found === undefined || found.content === undefined) {
      return { matches, ...(found?.hash === undefined ? {} : { actual: found.hash }) };
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
  ArtifactFailure | AgentCliFailure | LedgerStoreFailure,
  ArtifactFiles | AgentCli | LedgerStore | PlatformService
> {
  return Effect.gen(function* () {
    if (!touchesDisk(step)) {
      return;
    }
    const { locator } = step;
    if (locator.kind === "cli-registration") {
      const commands = registrationCommands(step, entry);
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
      return yield* files.write(locator, yield* (yield* LedgerStore).getPreImage(record.scope, op.preImage.blobRef));
    }
    return yield* files.remove(locator);
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
): Effect.Effect<ApplyReport, ApplyInstallError, ArtifactFiles | AgentCli | LedgerStore | PlatformService> {
  return Effect.gen(function* () {
    const plan = record.aggregate;
    const { planId, steps } = plan;
    const ledger = start.ledger;
    const stale = plan.staleAgainst(ledger);
    if (stale !== undefined) {
      return yield* Effect.fail(stale satisfies PlanStale);
    }
    const store = yield* LedgerStore;
    const registrations = registrationLookup(record.adapters, record.context);
    const preImages: Record<string, PreImage> = {};
    for (const step of steps) {
      const check = yield* checkPrecondition(step, ledger.entry(step.locator), registrations);
      if (!check.matches) {
        return yield* Effect.fail({
          _tag: "TargetChanged",
          planId,
          locator: step.locator,
          expected: step.precondition,
          ...(check.actual === undefined ? {} : { actual: check.actual }),
          completed: 0
        } satisfies TargetChanged);
      }
      if (step.capturePreImage && check.actual !== undefined && check.content !== undefined) {
        const blobRef = yield* store.putPreImage(record.scope, check.content);
        preImages[locatorKey(step.locator)] = { existed: true, hash: check.actual, blobRef };
      }
    }
    const begun = yield* fromResult(ledger.begin(plan, { at: yield* nowIso, toolVersion: TOOL_VERSION, preImages }));
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
          if (!check.matches) {
            const failure: TargetChanged = {
              _tag: "TargetChanged",
              planId,
              locator: step.locator,
              expected: step.precondition,
              ...(check.actual === undefined ? {} : { actual: check.actual }),
              completed: index
            };
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
      applied.push({
        locator: step.locator,
        action: step.action,
        ...(step.removal === undefined ? {} : { removal: step.removal })
      });
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
