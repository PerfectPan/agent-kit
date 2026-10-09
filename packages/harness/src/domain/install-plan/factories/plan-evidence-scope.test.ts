import type { CodingAgentId } from "@rivus/agent-kit-catalog";
import { describe, expect, it } from "vitest";

import { builtinHookDialects } from "../../lifecycle/adapters/hook-dialects.js";
import { builtinInstallAdapters } from "../../bundle/adapters/install-adapters.js";
import type { Bundle } from "../../bundle/value-objects/bundle.js";
import { Ledger } from "../../ledger/aggregates/ledger.js";
import type { LedgerEntry } from "../../ledger/entities/ledger-entry.js";
import type { ContentHash } from "../../ledger/value-objects/content-hash.js";
import { type ArtifactLocator, locatorKey } from "../value-objects/artifact-locator.js";
import type { DesiredArtifact } from "../value-objects/desired-artifact.js";
import type { InstallContext } from "../../bundle/value-objects/install-adapter.js";
import type { ObservedArtifact } from "../value-objects/observed-artifact.js";
import type { PlanStep } from "../value-objects/plan-step.js";
import { planEvidenceScope } from "./plan-evidence-scope.js";
import type { ForeignHookObservation } from "../policies/legacy-ownership.js";
import { retainedForeignConflict } from "../policies/legacy-ownership.js";

const OWNER = "agent-presence";
const context: InstallContext = { home: "/u/me", env: {} };

const hookBundle = (overrides: Partial<Bundle> = {}): Bundle => ({
  owner: OWNER,
  version: "2.0.0",
  digest: "d2",
  artifacts: [{ type: "hooks", command: "/u/me/.local/bin/presence-hook", events: { grok: ["Stop"] } }],
  legacyMarkers: ["agent-presence hook"],
  ...overrides
});

const h = (n: number): ContentHash => `sha256:${n.toString(16).padStart(64, "0")}`;

const grokHookFile: ArtifactLocator = { kind: "file", path: "/u/me/.grok/hooks/agent-presence.json" };
const claudeStop = (command: string): ArtifactLocator => ({
  kind: "json-entry",
  path: "/u/me/.claude/settings.json",
  pointer: "/hooks/Stop",
  member: command,
  memberIn: "hook-group"
});

const wanted = (locator: ArtifactLocator): DesiredArtifact => ({
  agent: "grok",
  locator,
  content: "{}",
  hash: h(2),
  strategy: "scan-directory"
});

const emptyLedger = (): Ledger => {
  const restored = Ledger.restore({
    schemaVersion: 1,
    lineage: "lineage-1",
    revision: 1,
    entries: {},
    pending: []
  });
  if (!restored.ok) {
    throw new Error(JSON.stringify(restored.error));
  }
  return restored.value;
};

const ledgerWithEntry = (locator: ArtifactLocator): Ledger => {
  const entry: LedgerEntry = {
    locator,
    owners: [OWNER],
    activeOwner: OWNER,
    agents: ["claude-code"],
    bundleVersion: "1.0.0",
    toolVersion: "0.1.0",
    contentHash: h(1),
    preImage: { existed: false },
    appliedAt: "2026-10-01T00:00:00.000Z",
    entryRevision: 1
  };
  const restored = Ledger.restore({
    schemaVersion: 1,
    lineage: "lineage-1",
    revision: 1,
    entries: { [locatorKey(locator)]: entry },
    pending: []
  });
  if (!restored.ok) {
    throw new Error(JSON.stringify(restored.error));
  }
  return restored.value;
};

describe("planEvidenceScope", () => {
  it("observes desired and owner-held locators and scans markers, including foreign files runners load", () => {
    const ledger = ledgerWithEntry(claudeStop("agent-presence hook"));
    const scope = planEvidenceScope({
      bundle: hookBundle(),
      agents: ["grok"],
      desired: [wanted(grokHookFile)],
      ledger,
      adapters: builtinInstallAdapters,
      dialects: builtinHookDialects,
      context
    });
    expect(scope.scanLegacy).toBe(true);
    expect(scope.locators.map((locator) => locator.path)).toContain("/u/me/.claude/settings.json");
    const foreign = scope.legacySources.filter((source) => source.runner === "grok");
    expect(
      foreign.some((source) => source.source.kind !== "files" && source.source.path === "/u/me/.claude/settings.json")
    ).toBe(true);
    expect(scope.rootCandidates).toContain("/u/me/.claude");
  });

  it("skips the whole legacy scan without markers, owner-held hook groups or kept groups", () => {
    const scope = planEvidenceScope({
      bundle: hookBundle({ legacyMarkers: undefined }),
      agents: ["grok"],
      desired: [wanted(grokHookFile)],
      ledger: emptyLedger(),
      adapters: builtinInstallAdapters,
      dialects: builtinHookDialects,
      context
    });
    expect(scope.scanLegacy).toBe(false);
    expect(scope.legacySources).toEqual([]);
  });

  it("drops foreign sources for an owner the runner turned off in compat readings", () => {
    const scope = planEvidenceScope({
      bundle: hookBundle(),
      agents: ["grok"],
      desired: [wanted(grokHookFile)],
      ledger: emptyLedger(),
      adapters: builtinInstallAdapters,
      dialects: builtinHookDialects,
      context,
      compat: [{ runner: "grok", agent: "claude-code", enabled: false }]
    });
    expect(
      scope.legacySources.some((source) => source.source.kind !== "files" && source.source.path.includes("claude"))
    ).toBe(false);
  });

  it("reads an agent named like a prototype key as adapterless instead of calling down the prototype chain", () => {
    const scope = planEvidenceScope({
      bundle: hookBundle({ legacyMarkers: undefined }),
      agents: ["constructor"] as unknown as readonly CodingAgentId[],
      desired: [wanted(grokHookFile)],
      ledger: emptyLedger(),
      adapters: builtinInstallAdapters,
      dialects: builtinHookDialects,
      context
    });
    expect(scope.rootCandidates).toEqual([]);
  });
});

describe("retainedForeignConflict", () => {
  const command = "agent-presence hook";
  const locator = claudeStop(command);
  const bundle = hookBundle();
  const ledger = ledgerWithEntry(locator);
  const observed: ObservedArtifact = { locator, hash: h(1) };
  const item: ForeignHookObservation = { observed, runner: "grok", event: "Stop" };

  const ctx = (steps: readonly PlanStep[], overrides: { readonly bundle?: Bundle; readonly ledger?: Ledger } = {}) => ({
    bundle: overrides.bundle ?? bundle,
    dialects: builtinHookDialects,
    ledger: overrides.ledger ?? ledger,
    steps
  });

  it("conflicts when a tracked foreign hook stays for another consumer", () => {
    const stays: PlanStep = {
      locator,
      action: "remove",
      agents: [],
      precondition: { hash: h(1) },
      capturePreImage: false,
      removal: "restore-pre-image"
    };
    expect(retainedForeignConflict("plan-1", [item], ctx([stays]))).toEqual({
      _tag: "PlanConflict",
      planId: "plan-1",
      conflicts: [
        {
          step: {
            locator,
            action: "conflict",
            conflict: "other-owner",
            agents: ["claude-code"],
            precondition: { hash: h(1) },
            capturePreImage: false
          },
          choices: []
        }
      ]
    });
  });

  it("stays silent when the plan deletes the hook, the bundle stops firing the event, or nobody tracks it", () => {
    const deletes: PlanStep = {
      locator,
      action: "remove",
      agents: [],
      precondition: { hash: h(1) },
      capturePreImage: false,
      removal: "delete"
    };
    expect(retainedForeignConflict("plan-1", [item], ctx([deletes]))).toBeUndefined();
    expect(
      retainedForeignConflict("plan-1", [item], ctx([deletes], { bundle: hookBundle({ artifacts: [] }) }))
    ).toBeUndefined();
    const untracked = ledgerWithEntry({ ...locator, member: "other hook" });
    expect(retainedForeignConflict("plan-1", [item], ctx([deletes], { ledger: untracked }))).toBeUndefined();
  });
});
