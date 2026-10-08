import * as Effect from "effect/Effect";

import type { LedgerEntry, PendingOperation } from "../domain/ledger/index.js";
import { type PlanStale } from "../domain/install-plan/index.js";
import { fromResult } from "./from-result.js";
import { type InstallPlan, recordOf } from "./install-plan-handle.js";
import { ledgerScope, type ScopeOptions } from "./ledger-scope.js";
import { type LedgerReadError, loadLedger } from "./ledger-session.js";
import type { LedgerStore } from "./ports.js";

export interface Inventory {
  /** Absent for a scope without a stored ledger. */
  readonly lineage?: string;
  readonly revision: number;
  readonly entries: readonly LedgerEntry[];
  /** Operations an interrupted change left; the next change probes them under the LedgerLock. */
  readonly pending: readonly PendingOperation[];
}

/** What the scope's ledger records, read without the lock; it may change right after. */
export function inventory(options: ScopeOptions = {}): Effect.Effect<Inventory, LedgerReadError, LedgerStore> {
  return Effect.gen(function* () {
    const { ledger, stored } = yield* loadLedger(yield* ledgerScope(options));
    const recorded = { revision: ledger.revision, entries: ledger.entries(), pending: ledger.pending };
    return stored ? { ...recorded, lineage: ledger.lineage } : recorded;
  });
}

/** Drops a plan without applying it; applying it afterwards fails with `PlanStale`. */
export function discardPlan(plan: InstallPlan): Effect.Effect<void, PlanStale> {
  return Effect.gen(function* () {
    const record = yield* Effect.sync(() => recordOf(plan));
    record.aggregate = (yield* fromResult(record.aggregate.discard())).state;
  });
}
