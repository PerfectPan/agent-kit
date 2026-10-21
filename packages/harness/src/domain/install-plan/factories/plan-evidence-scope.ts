import { lookupService } from "@rivus/agent-kit-catalog/public";
import type { CodingAgentId } from "@rivus/agent-kit-catalog/public";

import { type ForeignHookFile, foreignHookFiles, type HookCompat } from "../../bundle/services/hook-registrations.js";
import type { ArtifactSource, InstallAdapters, InstallContext } from "../../bundle/spi/install-adapter.js";
import type { Owner } from "../../bundle/value-objects/owner.js";
import type { HookDialects } from "../../lifecycle/spi/hook-dialect.js";
import type { Ledger } from "../../ledger/aggregates/ledger.js";
import type { ArtifactLocator } from "../value-objects/artifact-locator.js";
import type { DesiredArtifact } from "../value-objects/desired-artifact.js";

/** A place older versions may have left hooks, optionally one a selected runner executes under renamed events. */
export interface LegacyHookSource {
  readonly source: ArtifactSource;
  /**
   * The agent a find in this source is effective in: the selected agent whose own `legacySources` declared it, or the
   * selected runner that executes another agent's file.
   */
  readonly agent: CodingAgentId;
  /** When set, only hooks for these runner events are taken from the source. */
  readonly events?: ReadonlySet<string>;
  /** The selected agent that also executes this other agent's file; set exactly for a foreign source, where it equals `agent`. */
  readonly runner?: CodingAgentId;
  /** Owner event name → the runner's name, recorded back onto the observation. */
  readonly runAs?: Readonly<Record<string, string>>;
}

const escapePointer = (event: string): string => `/hooks/${event.replaceAll("~", "~0").replaceAll("/", "~1")}`;

const parentOf = (path: string): string => path.slice(0, Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\")));

function foreignSource(file: ForeignHookFile, runner: CodingAgentId): LegacyHookSource[] {
  const events = new Set(Object.keys(file.rename));
  const { format } = file.source;
  // The file the runner actually loads (`file.path`); the matched (or fallback) source only supplies its shape.
  const path = file.path;
  if (file.source.layout === "grouped") {
    return [
      {
        source: { kind: "entries", path, format, pointer: "/hooks", memberIn: "hook-group" },
        agent: runner,
        events,
        runner,
        runAs: file.rename
      }
    ];
  }
  return [...events].map((event) => ({
    source: { kind: "entries" as const, path, format, pointer: escapePointer(event), memberIn: "element" },
    agent: runner,
    runner,
    runAs: file.rename
  }));
}

/**
 * Every source the plan scans for legacy hooks: each selected agent's own `legacySources`, and the other agents' hook
 * files the selected runners execute (see `foreignHookFiles`). A grouped file is one source under `/hooks`; a flat
 * file is one source per runner event, its pointer naming the JSON-escaped event.
 */
export function legacyHookSources(
  owner: Owner,
  agents: readonly CodingAgentId[],
  adapters: InstallAdapters,
  dialects: HookDialects,
  context: InstallContext,
  compat: readonly HookCompat[] = []
): readonly LegacyHookSource[] {
  const own: LegacyHookSource[] = agents.flatMap((agent) => {
    const adapter = lookupService(agent, adapters);
    return (adapter.ok ? (adapter.value.legacySources?.(context, owner) ?? []) : []).map((source) => ({
      source,
      agent
    }));
  });
  const foreign: LegacyHookSource[] = agents.flatMap((runner) =>
    foreignHookFiles(runner, dialects, adapters, context, compat).flatMap((file) => foreignSource(file, runner))
  );
  return [...own, ...foreign];
}

/** What the use case must read before a plan can be built: the locators to observe, whether legacy is scanned, roots. */
export interface PlanEvidenceScope {
  /** Desired locators and every locator the owner already holds. */
  readonly locators: readonly ArtifactLocator[];
  /** Whether legacy sources must be scanned: markers, an owner-held hook group, or a kept hook group. */
  readonly scanLegacy: boolean;
  /**
   * Unresolved writable-root candidates: selected and owner agents' adapter roots (as declared, often under `~/`),
   * and the parent directory of every foreign hook file a runner executes. The use case resolves and de-duplicates
   * them.
   */
  readonly rootCandidates: readonly string[];
  /** The legacy sources to scan when `scanLegacy` is true. */
  readonly legacySources: readonly LegacyHookSource[];
}

/**
 * The evidence a plan's correctness depends on, without IO: what to observe, whether to scan legacy sources, and
 * which roots a planned write may land in. Roots cover the adapter homes of every agent the owner's entries touch
 * (a removal can update a settings file another of its agents shares) and the directory holding each foreign hook
 * file a selected runner executes. The legacy judgment needs only the owner and its markers, so the read-only
 * listing calls this with the markers its caller supplies, without a bundle.
 */
export function planEvidenceScope(input: {
  readonly owner: Owner;
  /** The owner's legacy markers; often empty for planning, whose markers ride in on the bundle. */
  readonly legacyMarkers: readonly string[];
  readonly agents: readonly CodingAgentId[];
  readonly desired: readonly DesiredArtifact[];
  readonly ledger: Ledger;
  readonly adapters: InstallAdapters;
  readonly dialects: HookDialects;
  readonly context: InstallContext;
  readonly compat?: readonly HookCompat[];
}): PlanEvidenceScope {
  const { owner, legacyMarkers, agents, desired, ledger, adapters, dialects, context } = input;
  const locators: ArtifactLocator[] = desired.map((artifact) => artifact.locator);
  for (const entry of ledger.entries()) {
    if (entry.heldBy(owner)) {
      locators.push(entry.locator);
    }
  }
  const ownerHoldsHookGroup = ledger
    .entries()
    .some((entry) => entry.heldBy(owner) && entry.locator.memberIn === "hook-group");
  const keptHookGroup = Object.values(ledger.keptRecords()).some((kept) => kept.locator.memberIn === "hook-group");
  const scanLegacy = legacyMarkers.length > 0 || ownerHoldsHookGroup || keptHookGroup;
  const sources = scanLegacy ? legacyHookSources(owner, agents, adapters, dialects, context, input.compat ?? []) : [];
  const rootedAgents = new Set([
    ...agents,
    ...ledger.entries().flatMap((entry) => (entry.heldBy(owner) ? entry.agents : []))
  ]);
  const rootCandidates: string[] = [];
  for (const agent of rootedAgents) {
    const adapter = lookupService(agent, adapters);
    rootCandidates.push(...(adapter.ok ? adapter.value.roots(context) : []));
  }
  for (const source of sources) {
    if (source.runner !== undefined) {
      rootCandidates.push(parentOf(source.source.kind === "files" ? source.source.dir : source.source.path));
    }
  }
  return { locators, scanLegacy, rootCandidates, legacySources: sources };
}
