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
import { type ArtifactLocator, type LocatorKey, locatorKey } from "../../domain/install-plan/index.js";
import {
  type ContentHash,
  type PendingOperations,
  threeWayVerify,
  type VerifyStatus
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
  renderBundle,
  requireUserScope
} from "./plan-install.js";
import type { ArtifactFailure } from "../ports.js";

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
export interface VerifiedArtifact {
  readonly locator: ArtifactLocator;
  readonly agents: readonly CodingAgentId[];
  readonly status: VerifyStatus;
}

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
  | Extract<PlanInstallError, { readonly _tag: "HookSpecRejected" | "HookOverlap" | "InvalidHookPlacement" }>;

/**
 * Compares the owner's Artifacts on disk with the ledger and, given the bundle, with what it wants, the way chezmoi
 * does (see `threeWayVerify`). Reading needs no lock; only when the ledger is behind the disk does verify take the
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
    const desired = new Map<LocatorKey, { locator: ArtifactLocator; hash: ContentHash; agents: CodingAgentId[] }>();
    const { ledger } = yield* loadLedger(scope);
    if (options.bundle !== undefined) {
      const bundle = yield* fromResult(checkBundle(options.bundle));
      const agents = options.agents ?? [
        ...new Set(
          ledger
            .entries()
            .filter((entry) => entry.owners.includes(owner))
            .flatMap((entry) => entry.agents)
        )
      ];
      const { rendered } = yield* renderBundle(bundle, agents, setup, options);
      for (const artifact of yield* desiredArtifacts(rendered)) {
        const key = locatorKey(artifact.locator);
        const known = desired.get(key);
        desired.set(key, {
          locator: artifact.locator,
          hash: artifact.hash,
          agents: [...new Set([...(known?.agents ?? []), artifact.agent])].toSorted()
        });
      }
    }

    const compare = Effect.fnUntraced(function* (owned: ReturnType<typeof ledger.entries>) {
      const artifacts: VerifiedArtifact[] = [];
      const behind: { locator: ArtifactLocator; contentHash: ContentHash }[] = [];
      for (const entry of owned) {
        const key = locatorKey(entry.locator);
        const actual = (yield* observe(entry.locator, registrations))?.hash;
        const want = desired.get(key)?.hash;
        const status = threeWayVerify({
          ledger: entry.contentHash,
          ...(actual === undefined ? {} : { actual }),
          ...(want === undefined ? {} : { desired: want })
        });
        artifacts.push({ locator: entry.locator, agents: entry.agents, status });
        if (status === "ledger-behind" && actual !== undefined) {
          behind.push({ locator: entry.locator, contentHash: actual });
        }
      }
      return { artifacts, behind };
    });

    const owned = ledger.entries().filter((entry) => entry.owners.includes(owner));
    const first = yield* compare(owned);
    const artifacts = [...first.artifacts];
    for (const [key, want] of desired) {
      if (ledger.entries().some((entry) => locatorKey(entry.locator) === key && entry.owners.includes(owner))) {
        continue;
      }
      const actual = (yield* observe(want.locator, registrations))?.hash;
      artifacts.push({
        locator: want.locator,
        agents: want.agents,
        status: threeWayVerify({ ...(actual === undefined ? {} : { actual }), desired: want.hash })
      });
    }
    if (first.behind.length === 0) {
      return { artifacts, acknowledged: [] };
    }

    // The silent update changes the ledger, so it runs under the lock against a fresh comparison.
    const acknowledged = yield* Effect.scoped(
      Effect.gen(function* () {
        const { loaded } = yield* lockLedger(scope, {
          waitMs: options.lockWaitMs ?? DEFAULT_LOCK_WAIT_MS,
          registrations
        });
        const again = yield* compare(loaded.ledger.entries().filter((entry) => entry.owners.includes(owner)));
        if (again.behind.length === 0) {
          return [];
        }
        const transition = yield* fromResult(loaded.ledger.acknowledge(again.behind, { at: yield* nowIso }));
        yield* Effect.uninterruptible(saveLedger(scope, loaded, transition));
        return again.behind.map(({ locator }) => locator);
      })
    );
    const updated = new Set(acknowledged.map(locatorKey));
    return {
      artifacts: artifacts.map((artifact) =>
        updated.has(locatorKey(artifact.locator)) ? { ...artifact, status: "in-sync" as const } : artifact
      ),
      acknowledged
    };
  });
}
