import type { CodingAgentId } from "@rivus/agent-kit-catalog";
import * as Effect from "effect/Effect";

import { checkBundle, type InstallAdapters, type InvalidBundle, type Owner } from "../../domain/bundle/index.js";
import type { ArtifactLocator, InvalidPlan, PlanConflict, PlanStale } from "../../domain/install-plan/index.js";
import { type PendingOperations, unionAgents } from "../../domain/ledger/index.js";
import { type ApplyInstallError, applyLocked, type ApplyReport } from "./apply-install.js";
import { fromResult } from "../services/from-result.js";
import { type InstallPlan, recordOf } from "../services/install-plan-handle.js";
import { ledgerScope, type ScopeOptions } from "../services/ledger-scope.js";
import { DEFAULT_LOCK_WAIT_MS, lockLedger } from "../services/ledger-session.js";
import { registrationLookup } from "../services/observe.js";
import { buildPlan, type HarnessServices, planSetup, requireUserScope } from "./plan-install.js";
import type { ArtifactFailure } from "../ports.js";

export interface UninstallOptions extends ScopeOptions {
  /**
   * The agents to uninstall from: by default every agent the owner's ledger entries name, and with `legacyMarkers`
   * every agent with an install adapter as well.
   */
  readonly agents?: readonly CodingAgentId[];
  /**
   * Substrings by which the owner recognizes what its older versions installed without a ledger; such Artifacts are
   * removed too.
   */
  readonly legacyMarkers?: readonly string[];
  readonly adapters?: InstallAdapters;
  readonly lockWaitMs?: number;
}

export interface UninstallReport extends ApplyReport {
  /** The plan that was applied, with every step and note. */
  readonly plan: InstallPlan;
  /** Artifacts the user changed: they stay as the user's, without ownership entries but with protection records. */
  readonly kept: readonly ArtifactLocator[];
}

export type UninstallError =
  | InvalidBundle
  | PendingOperations
  | PlanStale
  | InvalidPlan
  | PlanConflict
  | ArtifactFailure
  | ApplyInstallError;

/**
 * Removes what the ledger records for an owner, under one holding of the LedgerLock: plans the removal (an install
 * plan in which the owner wants nothing) against the ledger read under the lock and applies it at once. Only the
 * owner's entries go: a file harness created is deleted, a pre-image restored, an entry other owners or agents still
 * use released, and an Artifact the user changed since is kept and reported. With `legacyMarkers`, what older versions
 * of the owner left without a ledger is removed as well. Nothing is written at a path a dotfiles manager owns or
 * through a symlink; such steps are notes of the plan.
 */
export function uninstall(
  owner: Owner,
  options: UninstallOptions = {}
): Effect.Effect<UninstallReport, UninstallError, HarnessServices> {
  return Effect.scoped(
    Effect.gen(function* () {
      requireUserScope(options);
      const legacyMarkers = options.legacyMarkers ?? [];
      const bundle = yield* fromResult(
        checkBundle({
          owner,
          version: "uninstall",
          digest: "uninstall",
          artifacts: [],
          ...(options.legacyMarkers === undefined ? {} : { legacyMarkers: options.legacyMarkers })
        })
      );
      const setup = yield* planSetup(options);
      const scope = yield* ledgerScope(options);
      const { loaded } = yield* lockLedger(scope, {
        waitMs: options.lockWaitMs ?? DEFAULT_LOCK_WAIT_MS,
        registrations: registrationLookup(setup.adapters, setup.context)
      });
      // Legacy Artifacts are in no ledger entry, so with markers every agent with an adapter is searched.
      const searched = legacyMarkers.length > 0 ? (Object.keys(setup.adapters) as CodingAgentId[]) : [];
      const agents = options.agents ?? unionAgents(loaded.ledger.agentsOf(owner), searched);
      const plan = yield* buildPlan(scope, loaded, { bundle, agents, setup, desired: [], droppedHooks: [] });
      const report = yield* applyLocked(recordOf(plan), loaded);
      return { ...report, plan, kept: recordOf(plan).aggregate.kept };
    })
  );
}
