import { legacyText } from "../services/legacy-artifact.js";
import type { InstallProviders } from "../providers.js";
import type { CodingAgentId } from "@rivus/agent-kit-catalog/public";
import type { PlatformService } from "@rivus/agent-kit-platform/effect";
import * as Effect from "effect/Effect";

import { checkOwnerMarkers, type InvalidBundle } from "../../domain/bundle/value-objects/bundle.js";
import { type HookCompat } from "../../domain/bundle/services/hook-registrations.js";
import { type OwnerSnapshot } from "../../domain/bundle/value-objects/owner.js";
import {
  type ArtifactKind,
  type ArtifactLocatorSnapshot,
  locatorKey,
  pointerTail
} from "../../domain/install-plan/value-objects/artifact-locator.js";
import { type LegacyTreatment, legacyTreatment } from "../../domain/install-plan/services/legacy-ownership.js";
import { type ObservedArtifact } from "../../domain/install-plan/spi/observed-artifact.js";
import { planEvidenceScope } from "../../domain/install-plan/factories/plan-evidence-scope.js";
import { type LegacyObservation, scanLegacy } from "../services/legacy-scan.js";
import { fromResult } from "../services/from-result.js";
import { type LedgerReadError, loadLedger } from "../services/ledger-session.js";
import { ledgerScope, type ScopeOptions } from "../services/ledger-scope.js";
import { observe, registrationLookup } from "../services/observe.js";
import { ArtifactFiles, type ArtifactFailure, LedgerRepository } from "../ports.js";
import { adapterOf, planSetup, requireUserScope } from "./plan-install.js";

export interface FindLegacyOptions extends ScopeOptions {
  /** The agents to scan: their own legacy sources, and the other agents' hook files they execute. */
  readonly agents: readonly CodingAgentId[];
  /**
   * The substrings by which the owner recognizes what its older versions installed without a ledger, such as their
   * hook command lines. Required: an install bundle may carry no markers, so they come from the caller. Blank
   * markers never match, by the shared rule.
   */
  readonly legacyMarkers: readonly string[];
  readonly providers: InstallProviders;
  /** What the application read about runners of other agents' hooks, such as Grok's `[compat.claude] hooks = false`. */
  readonly compat?: readonly HookCompat[];
}

/** One untracked entry an older version of the owner installed without a ledger, as the legacy scan found it. */
export interface LegacyEntry {
  /** The agent the entry is effective in: whose legacy source found it, or that runs the file holding it. */
  readonly agent: CodingAgentId;
  /** Where the entry sits: the file or directory, and for an entry in a document its position as the kit addresses it. */
  readonly locator: ArtifactLocatorSnapshot;
  /** What the locator addresses: a file, directory, or an entry inside a configuration document. */
  readonly kind: ArtifactKind;
  /** For a hook entry, the event that fires it, as `agent` names it. */
  readonly event?: string;
  /** For a hook entry, the command the agent runs. */
  readonly command?: string;
  /** What planning does with the entry: replace it with the owner's next Artifacts, or protect it for the user. */
  readonly treatment: LegacyTreatment;
}

export type FindLegacyError = InvalidBundle | ArtifactFailure | LedgerReadError;

/** The services the read-only listing needs: it never takes the LedgerLock and never asks an agent's command line. */
export type FindLegacyServices = ArtifactFiles | LedgerRepository | PlatformService;

/** Whether a locator addresses one hook of a configuration file's hook events, rather than another kind of entry. */
function isHookLocator(locator: ArtifactLocatorSnapshot): boolean {
  return locator.memberIn === "hook-group" || (locator.pointer?.startsWith("/hooks/") ?? false);
}

/** The event and command of a hook entry, with the event as the agent names it, or `undefined` for another entry. */
function hookOf(
  locator: ArtifactLocatorSnapshot,
  observation: LegacyObservation
): { readonly event: string } | undefined {
  if (!isHookLocator(locator)) {
    return undefined;
  }
  const event = observation.event ?? pointerTail(locator.pointer);
  return event === undefined ? undefined : { event };
}

/**
 * Lists, without changing anything: every untracked entry the scan reaches that the plan's own rule
 * (`legacyTreatment`) judges this owner's legacy artifact — what an older version installed without a ledger,
 * recognized by `legacyMarkers`. An entry the ledger records is not listed — nor a target an interrupted apply left
 * pending, which this read-only call cannot settle — and one the user kept on an earlier removal, or that cannot be
 * told apart from a deleted owned hook in its event, is listed as protected instead of replaced. The scan covers the selected agents' declared legacy sources and the other agents' hook files they
 * execute, and reads the owner's tracked locators the way the plan does, because they decide that protection. It
 * does not render a bundle: built-in adapters cover their file Artifacts, while a custom adapter's rendered path
 * is listed only when a legacy source covers it. An entry in a symlinked or
 * externally managed file is listed as `replace` although the plan refuses the path as an unresolvable conflict
 * (see the `/harness` spec for the boundary).
 */
export function findLegacy(
  owner: OwnerSnapshot,
  options: FindLegacyOptions
): Effect.Effect<readonly LegacyEntry[], FindLegacyError, FindLegacyServices> {
  return Effect.gen(function* () {
    requireUserScope(options);
    // The owner and the markers are checked the way uninstall's are, through the same shared rule.
    yield* fromResult(checkOwnerMarkers(owner, options.legacyMarkers));
    const setup = yield* planSetup(options);
    for (const agent of options.agents) {
      adapterOf(setup, agent);
    }
    const scope = yield* ledgerScope(options);
    const { ledger } = yield* loadLedger(scope);
    const evidence = planEvidenceScope({
      owner,
      legacyMarkers: options.legacyMarkers,
      agents: options.agents,
      desired: [],
      ledger,
      adapters: setup.adapters,
      dialects: setup.dialects,
      context: setup.context,
      ...(options.compat === undefined ? {} : { compat: options.compat })
    });
    const registrations = registrationLookup(setup.adapters, setup.context);
    // The observed set the plan judges legacy against: what the owner tracks, then the scan's finds, first wins.
    const observed = new Map<string, ObservedArtifact>();
    for (const locator of evidence.locators) {
      const found = yield* observe(locator, registrations);
      if (found !== undefined) {
        observed.set(locatorKey(locator), found);
      }
    }
    const finds: LegacyEntry[] = [];
    if (evidence.scanLegacy && evidence.legacySources.length > 0) {
      const listed = new Set<string>();
      for (const observation of yield* scanLegacy(evidence.legacySources)) {
        const key = locatorKey(observation.observed.locator);
        // Planning judges a locator once, by its first observation: an own source precedes a foreign one.
        if (observed.has(key) || listed.has(key)) {
          continue;
        }
        listed.add(key);
        observed.set(key, observation.observed);
        const treatment = legacyTreatment(
          observation.observed,
          owner,
          options.legacyMarkers,
          ledger,
          [...observed.values()],
          legacyText(observation.observed.content)
        );
        if (treatment === undefined) {
          continue;
        }
        const { locator } = observation.observed;
        const hook = hookOf(locator, observation);
        finds.push({
          agent: observation.agent,
          locator,
          kind: locator.kind,
          treatment,
          ...(hook === undefined ? {} : { event: hook.event }),
          ...(hook === undefined || locator.member === undefined ? {} : { command: locator.member })
        });
      }
    }
    return finds;
  });
}
