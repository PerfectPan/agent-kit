import { PlatformService } from "@rivus/agent-kit-platform/effect";
import * as Effect from "effect/Effect";
import type * as Scope from "effect/Scope";

import {
  type InvalidLedger,
  Ledger,
  type LedgerBusy,
  type LedgerRecovery,
  type LedgerTransition,
  type LedgerVersionUnsupported,
  type PendingProbe
} from "../domain/ledger/index.js";
import { fromResult } from "./from-result.js";
import { observe, type RegistrationLookup } from "./observe.js";
import {
  ArtifactFiles,
  type ArtifactFailure,
  LedgerLock,
  type LedgerLockFailure,
  type LedgerLockUnavailable,
  type LedgerScope,
  LedgerStore,
  type LedgerStoreFailure
} from "./ports.js";

/** How long a use case that changes the ledger waits for another holder of its LedgerLock, by default. */
export const DEFAULT_LOCK_WAIT_MS = 10_000;

export type LedgerReadError = LedgerStoreFailure | LedgerVersionUnsupported | InvalidLedger;
export type LedgerLockError = LedgerBusy | LedgerLockUnavailable | LedgerLockFailure;

/** A ledger as loaded: `stored` is false for a scope without one, which a first save creates. */
export interface LoadedLedger {
  readonly ledger: Ledger;
  readonly stored: boolean;
}

/** The ISO time of the platform's clock, recorded in the ledger. */
export const nowIso: Effect.Effect<string, never, PlatformService> = Effect.gen(function* () {
  return new Date((yield* PlatformService).clock.now()).toISOString();
});

/**
 * The scope's ledger, or a new empty one when the scope has none stored: with `lineage` (the lineage a plan was built
 * on, which a first apply keeps) or a fresh one.
 */
export function loadLedger(
  scope: LedgerScope,
  lineage?: string
): Effect.Effect<LoadedLedger, LedgerReadError, LedgerStore> {
  return Effect.gen(function* () {
    const snapshot = yield* (yield* LedgerStore).load(scope);
    if (snapshot === undefined) {
      return { ledger: yield* fromResult(Ledger.create(lineage ?? crypto.randomUUID())), stored: false };
    }
    return { ledger: yield* fromResult(Ledger.restore(snapshot)), stored: true };
  });
}

/**
 * Writes one transition's state over the ledger it came from, uninterruptibly. The store refuses when another writer
 * moved the ledger, which cannot happen while the caller holds the LedgerLock.
 */
export function saveLedger(
  scope: LedgerScope,
  from: LoadedLedger,
  transition: Pick<LedgerTransition, "state">
): Effect.Effect<LoadedLedger, LedgerStoreFailure | LedgerVersionUnsupported, LedgerStore> {
  return Effect.gen(function* () {
    if (transition.state === from.ledger && from.stored) {
      return from;
    }
    const store = yield* LedgerStore;
    // Uninterruptible, so that an interrupted caller releases the LedgerLock only after the write has landed: a late
    // rename after another process took the lock would roll the ledger back.
    yield* Effect.uninterruptible(
      store.save(scope, transition.state.toSnapshot(), from.stored ? from.ledger.revision : undefined)
    );
    return { ledger: transition.state, stored: true };
  });
}

/**
 * Resolves the operations an interrupted modification left pending from probes of their targets, never by
 * replaying them, and saves the result. Must run under the LedgerLock.
 */
export function recoverPending(
  scope: LedgerScope,
  loaded: LoadedLedger,
  registrations?: RegistrationLookup
): Effect.Effect<
  { readonly loaded: LoadedLedger; readonly recovery?: LedgerRecovery },
  ArtifactFailure | LedgerStoreFailure | LedgerVersionUnsupported,
  ArtifactFiles | LedgerStore | PlatformService
> {
  return Effect.gen(function* () {
    if (loaded.ledger.pending.length === 0) {
      return { loaded };
    }
    const probes: PendingProbe[] = [];
    for (const op of loaded.ledger.pending) {
      const hash = (yield* observe(op.locator, registrations))?.hash;
      probes.push(hash === undefined ? { locator: op.locator } : { locator: op.locator, hash });
    }
    const recovery = loaded.ledger.recover(probes, { at: yield* nowIso });
    return { loaded: yield* saveLedger(scope, loaded, recovery), recovery };
  });
}

export interface LockLedgerOptions {
  readonly waitMs: number;
  /** The lineage a new ledger gets when the scope has none stored: the one the plan to apply was built on. */
  readonly lineage?: string;
  /** How to read command-line registrations when probing pending operations. */
  readonly registrations?: RegistrationLookup;
}

/**
 * Takes the scope's LedgerLock in the caller's Scope, then loads the ledger and recovers what an earlier holder left
 * pending. Everything that changes the ledger runs after this, until the Scope closes.
 */
export function lockLedger(
  scope: LedgerScope,
  options: LockLedgerOptions
): Effect.Effect<
  { readonly loaded: LoadedLedger; readonly recovery?: LedgerRecovery },
  LedgerLockError | LedgerReadError | ArtifactFailure,
  LedgerLock | LedgerStore | ArtifactFiles | PlatformService | Scope.Scope
> {
  return Effect.gen(function* () {
    yield* (yield* LedgerLock).acquire(scope, { waitMs: options.waitMs });
    return yield* recoverPending(scope, yield* loadLedger(scope, options.lineage), options.registrations);
  });
}
