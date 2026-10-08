import { describe, expect, it } from "vitest";

import { Ledger } from "../../ledger/aggregates/ledger.js";
import type { ContentHash } from "../../ledger/value-objects/content-hash.js";
import type { LedgerEntry } from "../../ledger/entities/ledger-entry.js";
import { buildInstallPlan } from "../factories/build-install-plan.js";
import { type ArtifactLocator, locatorKey } from "../value-objects/artifact-locator.js";
import type { ObservedArtifact } from "../value-objects/observed-artifact.js";
import type { PlanStep } from "../value-objects/plan-step.js";
import { InstallPlan, type InstallPlanDraft } from "./install-plan.js";

const HOME = "/u/me";
const OWNER = "agent-presence";
const h = (n: number): ContentHash => `sha256:${n.toString(16).padStart(64, "0")}`;
const file = (name: string): ArtifactLocator => ({ kind: "file", path: `${HOME}/.claude/skills/${name}/SKILL.md` });

function entry(locator: ArtifactLocator, overrides: Partial<LedgerEntry> = {}): LedgerEntry {
  return {
    locator,
    owners: [OWNER],
    activeOwner: OWNER,
    agents: ["claude-code"],
    bundleVersion: "1.0.0",
    toolVersion: "0.1.0",
    contentHash: h(1),
    preImage: { existed: false },
    appliedAt: "2026-10-01T00:00:00.000Z",
    entryRevision: 1,
    ...overrides
  };
}

function ledger(entries: readonly LedgerEntry[] = []): Ledger {
  const restored = Ledger.restore({
    schemaVersion: 1,
    lineage: "lineage-1",
    revision: 3,
    entries: Object.fromEntries(entries.map((item) => [locatorKey(item.locator), item])),
    pending: []
  });
  if (!restored.ok) {
    throw new Error(JSON.stringify(restored.error));
  }
  return restored.value;
}

const draft = (steps: readonly PlanStep[]): InstallPlanDraft => ({
  planId: "plan-1",
  basedOn: { ledgerLineage: "lineage-1", ledgerRevision: 3 },
  bundle: { owner: OWNER, version: "2.0.0", digest: "d" },
  target: { scope: "user", agents: ["claude-code"], roots: [`${HOME}/.claude`] },
  steps,
  expectedTrustPrompts: []
});

const remove = (locator: ArtifactLocator, overrides: Partial<PlanStep> = {}): PlanStep => ({
  locator,
  action: "remove",
  agents: [],
  precondition: { hash: h(1) },
  capturePreImage: false,
  removal: "delete",
  ...overrides
});

/** What is on disk for each step's precondition, unless a test observes something else. */
const observedFor = (steps: readonly PlanStep[]): ObservedArtifact[] =>
  steps.flatMap(({ locator, precondition }) => ("hash" in precondition ? [{ locator, hash: precondition.hash }] : []));

const create = (
  steps: readonly PlanStep[],
  entries: readonly LedgerEntry[] = [],
  observed: readonly ObservedArtifact[] = observedFor(steps)
) => InstallPlan.create(draft(steps), { ledger: ledger(entries), observed, legacyMarkers: ["@rivus/agent-presence"] });

describe("InstallPlan.create", () => {
  const userFile = file("notes");

  it("refuses a legacy removal without observed content that matches the legacy markers", () => {
    const step = remove(userFile, { legacy: true });
    expect(create([step])).toMatchObject({
      ok: false,
      error: { _tag: "InvalidPlan", reason: "not-owned", detail: "no observed evidence of an older install" }
    });
    expect(create([step], [], [{ locator: userFile, hash: h(1), content: "my own notes" }])).toMatchObject({
      ok: false,
      error: { reason: "not-owned" }
    });
    expect(
      create([step], [], [{ locator: userFile, hash: h(1), content: "// @rivus/agent-presence pi extension" }])
    ).toMatchObject({ ok: true });
  });

  it("deletes or restores only an entry the owner holds alone for agents the plan covers", () => {
    const shared = entry(userFile, { owners: [OWNER, "other-app"] });
    expect(create([remove(userFile)], [shared])).toMatchObject({
      ok: false,
      error: { reason: "not-owned", detail: "other owners or agents still use it" }
    });
    expect(create([remove(userFile)], [entry(userFile, { agents: ["claude-code", "codex"] })])).toMatchObject({
      ok: false,
      error: { reason: "not-owned" }
    });
    expect(
      create([remove(userFile, { removal: "release", agents: ["claude-code"] })], [entry(userFile)])
    ).toMatchObject({
      ok: false,
      error: { reason: "not-owned", detail: "a release that would leave it without owners or agents" }
    });
    expect(
      create([remove(userFile)], [entry(userFile, { preImage: { existed: true, hash: h(5), blobRef: "b" } })])
    ).toMatchObject({
      ok: false,
      error: { reason: "not-owned", detail: "a delete of what has a pre-image to restore" }
    });
    expect(create([remove(userFile)], [entry(userFile)])).toMatchObject({ ok: true });
  });

  it("refuses a write over another owner's entry unless it is forced", () => {
    const update: PlanStep = {
      locator: userFile,
      action: "update",
      agents: ["claude-code"],
      precondition: { hash: h(1) },
      desired: { hash: h(2), content: "x" },
      capturePreImage: false
    };
    const theirs = entry(userFile, { owners: ["other-app"], activeOwner: "other-app" });
    expect(create([update], [theirs])).toMatchObject({ ok: false, error: { reason: "not-owned" } });
    expect(create([{ ...update, conflict: "other-owner", choice: "force" }], [theirs])).toMatchObject({ ok: true });
  });

  it("checks write steps against what was observed, not against the step's own fields", () => {
    const write: PlanStep = {
      locator: userFile,
      action: "update",
      agents: ["claude-code"],
      precondition: { hash: h(1) },
      desired: { hash: h(2), content: "x" },
      capturePreImage: false
    };
    expect(create([write])).toMatchObject({
      ok: false,
      error: { reason: "not-owned", detail: "an unrecorded file overwritten without an adopt or backup choice" }
    });
    expect(
      create([{ ...write, action: "adopt", conflict: "unmanaged-exists", choice: "backup", capturePreImage: true }])
    ).toMatchObject({
      ok: true
    });
    expect(create([write], [entry(userFile)], [{ locator: userFile, hash: h(1), managedBy: "chezmoi" }])).toMatchObject(
      {
        ok: false,
        error: { reason: "not-owned", detail: "a write or delete at a dotfiles-managed or symlinked path" }
      }
    );
    expect(create([write], [entry(userFile)], [{ locator: userFile, hash: h(9) }])).toMatchObject({
      ok: false,
      error: { reason: "invalid-step", detail: "a precondition other than what was observed" }
    });
    expect(
      create([{ ...write, action: "create", precondition: { absent: true } }], [], [{ locator: userFile, hash: h(1) }])
    ).toMatchObject({
      ok: false,
      error: { reason: "invalid-step", detail: "a precondition other than what was observed" }
    });
    const takeLink: PlanStep = { ...write, action: "adopt", desired: { hash: h(1), content: "x" } };
    const linked = [{ locator: userFile, hash: h(1), symlinkTarget: "/dotfiles/notes.md" }];
    expect(create([takeLink], [], linked)).toMatchObject({
      ok: false,
      error: { reason: "not-owned", detail: "a symlink's content taken without an explicit adopt" }
    });
    expect(create([{ ...takeLink, conflict: "symlinked-target", choice: "adopt" }], [], linked)).toMatchObject({
      ok: true
    });
  });

  it("records a file the ledger lacks only with its pre-image kept, an adopt or backup choice, or legacy evidence", () => {
    const take: PlanStep = {
      locator: userFile,
      action: "noop",
      agents: ["claude-code"],
      precondition: { hash: h(1) },
      desired: { hash: h(1), content: "x" },
      capturePreImage: false
    };
    const reason = {
      reason: "not-owned",
      detail: "an unrecorded file taken without a pre-image, an adopt or backup choice"
    };
    expect(create([take])).toMatchObject({ ok: false, error: reason });
    expect(create([{ ...take, action: "adopt" }])).toMatchObject({ ok: false, error: reason });
    expect(create([{ ...take, action: "adopt", capturePreImage: true }])).toMatchObject({ ok: true });
  });

  it("offers adopt for a symlinked target only where no ledger entry exists, the one case adopt resolves", () => {
    const conflict: PlanStep = {
      locator: userFile,
      action: "conflict",
      agents: ["claude-code"],
      precondition: { hash: h(2) },
      desired: { hash: h(2), content: "x" },
      capturePreImage: false,
      conflict: "symlinked-target"
    };
    const linked = [{ locator: userFile, hash: h(2), symlinkTarget: "/dotfiles/notes.md" }];
    expect(create([conflict], [], linked)).toMatchObject({ ok: false, error: { conflicts: [{ choices: ["adopt"] }] } });
    const theirs = entry(userFile, { owners: ["other-app"], activeOwner: "other-app" });
    expect(create([conflict], [theirs], linked)).toMatchObject({ ok: false, error: { conflicts: [{ choices: [] }] } });
  });

  it("rejects a conflict without a reason as invalid and one with a reason as PlanConflict", () => {
    const conflict: PlanStep = {
      locator: userFile,
      action: "conflict",
      agents: ["claude-code"],
      precondition: { hash: h(1) },
      capturePreImage: false
    };
    expect(create([conflict])).toMatchObject({
      ok: false,
      error: { _tag: "InvalidPlan", reason: "invalid-step", detail: "a conflict without a reason" }
    });
    expect(create([{ ...conflict, conflict: "unmanaged-exists" }])).toMatchObject({
      ok: false,
      error: { _tag: "PlanConflict", conflicts: [{ choices: ["adopt", "backup"] }] }
    });
  });

  it.each([
    ["an invalid desired hash", { desired: { hash: "sha256:ABC" as ContentHash, content: "x" } }],
    ["an invalid precondition", { precondition: { hash: "sha256:abc" as ContentHash } }],
    ["no agents for an Artifact the ledger records", { agents: [] }],
    ["a pre-image to capture where nothing is", { precondition: { absent: true }, capturePreImage: true }]
  ] as const)("refuses a step with %s, which the ledger could not record", (detail, overrides) => {
    const step: PlanStep = {
      locator: userFile,
      action: "create",
      agents: ["claude-code"],
      precondition: { absent: true },
      desired: { hash: h(2), content: "x" },
      capturePreImage: false,
      ...overrides
    };
    expect(create([step])).toMatchObject({ ok: false, error: { reason: "invalid-step", detail } });
  });

  it("refuses desired or observed hashes that are not sha256 when building a plan", () => {
    const request = {
      planId: "plan-1",
      bundle: { owner: OWNER, version: "2.0.0", digest: "d", artifacts: [] },
      target: { scope: "user", agents: ["claude-code"], roots: [`${HOME}/.claude`] }
    } as const;
    const want = { agent: "claude-code", locator: userFile, content: "x", strategy: "native-plugin" } as const;
    expect(
      buildInstallPlan({ ...request, desired: [{ ...want, hash: "sha256:ABC" as ContentHash }] }, ledger(), [])
    ).toMatchObject({ ok: false, error: { reason: "invalid-step", detail: "an invalid desired hash" } });
    expect(
      buildInstallPlan({ ...request, desired: [{ ...want, hash: h(2) }] }, ledger([entry(userFile)]), [
        { locator: userFile, hash: "md5:1" as ContentHash }
      ])
    ).toMatchObject({ ok: false, error: { reason: "invalid-step", detail: "an invalid precondition" } });
  });
});

describe("InstallPlan.staleAgainst", () => {
  const ready = () => create([]);

  it("is ready against the ledger it was built on and stale once that ledger moved", () => {
    const created = ready();
    if (!created.ok) {
      throw new Error("empty plan should create");
    }
    const plan = created.value;
    expect(plan.staleAgainst({ lineage: "lineage-1", revision: 3 })).toBeUndefined();
    expect(plan.staleAgainst({ lineage: "lineage-2", revision: 3 })).toMatchObject({ reason: "ledger-moved" });
    expect(plan.staleAgainst({ lineage: "lineage-1", revision: 4 })).toMatchObject({ reason: "ledger-moved" });
  });

  it("reports a closed plan before any ledger comparison", () => {
    const created = ready();
    if (!created.ok) {
      throw new Error("empty plan should create");
    }
    const applied = created.value.markApplied();
    expect(applied.ok && applied.value.state.staleAgainst({ lineage: "lineage-1", revision: 3 })).toMatchObject({
      reason: "applied"
    });
  });
});
