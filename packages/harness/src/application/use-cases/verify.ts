import type { CodingAgentId } from "@rivus/agent-kit-catalog";
import * as Effect from "effect/Effect";

import {
  type Bundle,
  checkBundle,
  type HookCompat,
  type InstallAdapters,
  type InvalidBundle,
  type Owner
} from "../../domain/bundle/index.js";
import {
  type ArtifactLocator,
  type DesiredArtifact,
  type LocatorKey,
  locatorKey
} from "../../domain/install-plan/index.js";
import {
  type ContentHash,
  type LedgerEntry,
  markAcknowledged,
  type PendingOperations,
  type VerifiedArtifact,
  verifyOwner
} from "../../domain/ledger/index.js";
import type { HookDialects } from "../../domain/lifecycle/index.js";
import type { StrategyUnavailable } from "../errors.js";
import { fromResult } from "../services/from-result.js";
import { ledgerScope, type ScopeOptions } from "../services/ledger-scope.js";
import { observe, registrationLookup } from "../services/observe.js";
import {
  DEFAULT_LOCK_WAIT_MS,
  type LedgerLockError,
  type LedgerReadError,
  loadLedger,
  lockLedger,
  nowIso,
  saveLedger
} from "../services/ledger-session.js";
import {
  desiredArtifacts,
  type HarnessServices,
  planSetup,
  type PlanInstallError,
  type PlanInstallOptions,
  probeCommands,
  renderBundle,
  requireUserScope
} from "./plan-install.js";
import type { ArtifactFailure, RevisionConflict } from "../ports.js";

export interface VerifyOptions extends ScopeOptions {
  /**
   * What the owner wants installed now. With it, verify also tells an outdated Artifact from one the user changed,
   * finds desired Artifacts that are missing, and records silently in the ledger what is on disk already as desired.
   */
  readonly bundle?: Bundle;
  /** The agents the bundle is for; every agent the owner's entries name by default. */
  readonly agents?: readonly CodingAgentId[];
  /** The strategies the bundle was installed with, when they were not the adapters' preference. */
  readonly strategies?: PlanInstallOptions["strategies"];
  readonly compat?: readonly HookCompat[];
  readonly adapters?: InstallAdapters;
  readonly dialects?: HookDialects;
  readonly lockWaitMs?: number;
}

/** One Artifact as three-way verify sees it: the ledger's record, what is on disk and what the bundle wants. */
export type { VerifiedArtifact };

export interface VerifyReport {
  readonly artifacts: readonly VerifiedArtifact[];
  /** Entries whose record was updated silently (`ledger-behind`): the disk already held the desired content. */
  readonly acknowledged: readonly ArtifactLocator[];
}

export type VerifyError =
  | InvalidBundle
  | StrategyUnavailable
  | PendingOperations
  | ArtifactFailure
  | LedgerReadError
  | LedgerLockError
  | RevisionConflict
  | Extract<PlanInstallError, { readonly _tag: "HookSpecRejected" | "HookOverlap" | "InvalidHookPlacement" }>;

/**
 * Compares the owner's Artifacts on disk with the ledger and, given the bundle, with what it wants, the way chezmoi
 * does (see `verifyOwner`). Reading needs no lock; only when the ledger is behind the disk does verify take the
 * LedgerLock, compare again under it and record the disk's hash (`acknowledge`).
 */
export function verify(
  owner: Owner,
  options: VerifyOptions = {}
): Effect.Effect<VerifyReport, VerifyError, HarnessServices> {
  return Effect.gen(function* () {
    requireUserScope(options);
    const scope = yield* ledgerScope(options);
    const setup = yield* planSetup(options);
    const registrations = registrationLookup(setup.adapters, setup.context);
    const { ledger } = yield* loadLedger(scope);
    let desired: readonly DesiredArtifact[] = [];
    if (options.bundle !== undefined) {
      const bundle = yield* fromResult(checkBundle(options.bundle));
      const agents = options.agents ?? ledger.agentsOf(owner);
      const available = yield* probeCommands(agents, setup);
      const { rendered } = yield* renderBundle(bundle, agents, setup, { ...options, available });
      desired = yield* desiredArtifacts(rendered);
    }

    /** The disk's hashes at every held locator and at every desired one the owner does not hold. */
    const watch = Effect.fnUntraced(function* (entries: readonly LedgerEntry[]) {
      const held = new Set(entries.map((entry) => locatorKey(entry.locator)));
      const unheld = new Map<LocatorKey, ArtifactLocator>();
      for (const want of desired) {
        if (!held.has(locatorKey(want.locator))) {
          unheld.set(locatorKey(want.locator), want.locator);
        }
      }
      const observed = new Map<LocatorKey, ContentHash>();
      for (const locator of [...entries.map((entry) => entry.locator), ...unheld.values()]) {
        const seen = yield* observe(locator, registrations);
        if (seen !== undefined) {
          observed.set(locatorKey(locator), seen.hash);
        }
      }
      return observed;
    });

    const owned = ledger.entriesOf(owner);
    const first = verifyOwner(owned, yield* watch(owned), desired);
    if (first.behind.length === 0) {
      return { artifacts: first.artifacts, acknowledged: [] };
    }

    // The silent update changes the ledger, so it runs under the lock against a fresh comparison.
    const acknowledged = yield* Effect.scoped(
      Effect.gen(function* () {
        const { loaded } = yield* lockLedger(scope, {
          waitMs: options.lockWaitMs ?? DEFAULT_LOCK_WAIT_MS,
          registrations
        });
        const again = loaded.ledger.entriesOf(owner);
        const verification = verifyOwner(again, yield* watch(again), desired);
        if (verification.behind.length === 0) {
          return [];
        }
        const transition = yield* fromResult(loaded.ledger.acknowledge(verification.behind, { at: yield* nowIso }));
        yield* Effect.uninterruptible(saveLedger(scope, loaded, transition));
        return verification.behind.map(({ locator }) => locator);
      })
    );
    const report = markAcknowledged(first, acknowledged);
    return { artifacts: report.artifacts, acknowledged };
  });
}
