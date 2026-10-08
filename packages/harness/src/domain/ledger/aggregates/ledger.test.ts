import { isAgentKitError } from "@rivus/agent-kit-catalog";
import { describe, expect, it } from "vitest";

import type { Bundle } from "../../bundle/value-objects/bundle.js";
import type { InstallPlan } from "../../install-plan/aggregates/install-plan.js";
import { buildInstallPlan, type PlanRequest } from "../../install-plan/factories/build-install-plan.js";
import { type ArtifactLocator, locatorKey } from "../../install-plan/value-objects/artifact-locator.js";
import type { ObservedArtifact } from "../../install-plan/value-objects/observed-artifact.js";
import type { ContentHash } from "../value-objects/content-hash.js";
import type { LedgerEntry } from "../entities/ledger-entry.js";
import type { PendingOperation } from "../entities/pending-operation.js";
import { checkLedgerVersion, Ledger, type LedgerSnapshot } from "./ledger.js";

const HOME = "/u/me";
const OWNER = "agent-presence";
const AT = "2026-10-08T00:00:00.000Z";
const h = (n: number): ContentHash => `sha256:${n.toString(16).padStart(64, "0")}`;
const file = (name: string): ArtifactLocator => ({ kind: "file", path: `${HOME}/.claude/skills/${name}/SKILL.md` });
const BUNDLE: Bundle = { owner: OWNER, version: "2.0.0", digest: "d2", artifacts: [] };

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

function snapshot(entries: readonly LedgerEntry[] = [], overrides: Partial<LedgerSnapshot> = {}): LedgerSnapshot {
  return {
    schemaVersion: 1,
    lineage: "lineage-1",
    revision: 3,
    entries: Object.fromEntries(entries.map((item) => [locatorKey(item.locator), item])),
    pending: [],
    ...overrides
  };
}

function restore(value: LedgerSnapshot): Ledger {
  const restored = Ledger.restore(value);
  if (!restored.ok) {
    throw new Error(JSON.stringify(restored.error));
  }
  return restored.value;
}

function planOn(
  ledger: Ledger,
  observed: readonly ObservedArtifact[],
  request: Partial<PlanRequest> = {}
): InstallPlan {
  const built = buildInstallPlan(
    {
      planId: "plan-1",
      bundle: BUNDLE,
      target: { scope: "user", agents: ["claude-code"], roots: [`${HOME}/.claude`] },
      desired: [],
      ...request
    },
    ledger,
    observed
  );
  if (!built.ok) {
    throw new Error(JSON.stringify(built.error));
  }
  return built.value;
}

const want = (locator: ArtifactLocator, n: number) =>
  ({ agent: "claude-code", locator, content: `content ${n}`, hash: h(n), strategy: "native-plugin" }) as const;

/** Begins the plan and reports every step done. */
function applied(ledger: Ledger, plan: InstallPlan): Ledger {
  const begun = ledger.begin(plan, { at: AT, toolVersion: "0.2.0" });
  if (!begun.ok) {
    throw new Error(JSON.stringify(begun.error));
  }
  return begun.value.state.complete(
    plan.steps.map((step) => ({ locator: step.locator, status: "done" as const })),
    { at: AT }
  ).state;
}

/** The pending operation of a plan's first step, as `begin` records it. */
function pendingOf(plan: InstallPlan): PendingOperation {
  const [step] = plan.steps;
  if (step === undefined || step.action === "conflict") {
    throw new Error("no step");
  }
  return {
    planId: plan.planId,
    owner: OWNER,
    bundleVersion: "2.0.0",
    toolVersion: "0.2.0",
    locator: step.locator,
    action: step.action,
    agents: step.agents,
    precondition: step.precondition,
    startedAt: AT
  };
}

function thrown(run: () => unknown): unknown {
  try {
    run();
  } catch (error) {
    return error;
  }
  return undefined;
}

describe("Ledger", () => {
  it("starts empty at revision 0 and refuses an empty lineage", () => {
    const created = Ledger.create("lineage-1");
    expect(created.ok && created.value.toSnapshot()).toEqual({
      schemaVersion: 1,
      lineage: "lineage-1",
      revision: 0,
      entries: {},
      pending: []
    });
    expect(Ledger.create("")).toEqual({ ok: false, error: { _tag: "InvalidLedger", reason: "lineage is empty" } });
  });

  it("refuses an unknown schema version and leaves the stored data as it was", () => {
    const stored = { ...snapshot([entry(file("a"))]), schemaVersion: 2 };
    const before = JSON.stringify(stored);
    expect(Ledger.restore(stored)).toEqual({
      ok: false,
      error: { _tag: "LedgerVersionUnsupported", schemaVersion: 2, supported: [1] }
    });
    expect(JSON.stringify(stored)).toBe(before);
    for (const raw of [undefined, null, "1", { schemaVersion: "1" }, { schemaVersion: 0 }, { entries: {} }]) {
      expect(checkLedgerVersion(raw)).toMatchObject({ ok: false, error: { _tag: "LedgerVersionUnsupported" } });
    }
    expect(checkLedgerVersion({ schemaVersion: 1, entries: "anything" })).toEqual({ ok: true, value: 1 });
  });

  it.each([
    ["no owners", entry(file("a"), { owners: [] }), "entry owners are empty or repeated"],
    [
      "foreign active owner",
      entry(file("a"), { activeOwner: "other-app" }),
      "entry's active owner is not one of its owners"
    ],
    ["no agents", entry(file("a"), { agents: [] }), "entry has no agents"],
    ["bad hash", entry(file("a"), { contentHash: "sha256:xyz" }), "entry has an invalid content hash or pre-image"],
    [
      "future entry revision",
      entry(file("a"), { entryRevision: 4 }),
      "entry revision is not between 0 and the ledger revision"
    ]
  ])("refuses a ledger whose entry has %s", (_, broken, reason) => {
    expect(Ledger.restore(snapshot([broken]))).toEqual({
      ok: false,
      error: { _tag: "InvalidLedger", reason, key: locatorKey(broken.locator) }
    });
  });

  it("refuses an entry stored under another key", () => {
    const value = { ...snapshot(), entries: { '["/u/me/other"]': entry(file("a")) } };
    expect(Ledger.restore(value)).toMatchObject({ ok: false, error: { reason: "entry is not keyed by its locator" } });
  });

  it("records pending operations before acting, then the outcomes, one revision each", () => {
    const fresh = file("new");
    const backed = file("theirs");
    const old = file("old");
    const ledger = restore(snapshot([entry(old, { preImage: { existed: true, hash: h(30), blobRef: "blob-30" } })]));
    const plan = planOn(
      ledger,
      [
        { locator: backed, hash: h(9) },
        { locator: old, hash: h(1) }
      ],
      {
        desired: [want(fresh, 2), want(backed, 3)],
        choices: { [locatorKey(backed)]: "backup" }
      }
    );
    const preImage = { existed: true, hash: h(9), blobRef: "blob-9" } as const;

    const missing = thrown(() => ledger.begin(plan, { at: AT, toolVersion: "0.2.0" }));
    expect(isAgentKitError(missing) && missing.code).toBe("pre-image-missing");

    const begun = ledger.begin(plan, { at: AT, toolVersion: "0.2.0", preImages: { [locatorKey(backed)]: preImage } });
    expect(begun.ok).toBe(true);
    if (!begun.ok) {
      return;
    }
    const pending = begun.value.state;
    expect(pending.revision).toBe(4);
    expect(pending.entries()).toEqual(ledger.entries());
    expect(pending.pending.map((op) => [op.locator.path, op.action, op.preImage])).toEqual([
      [fresh.path, "create", undefined],
      [backed.path, "adopt", preImage],
      [old.path, "remove", { existed: true, hash: h(30), blobRef: "blob-30" }]
    ]);

    const done = pending.complete(
      [fresh, backed, old].map((locator) => ({ locator, status: "done" as const })),
      { at: AT }
    );
    expect(done.state.revision).toBe(5);
    expect(done.state.pending).toEqual([]);
    expect(done.state.entry(old)).toBeUndefined();
    expect(done.state.entry(fresh)).toEqual(
      entry(fresh, { contentHash: h(2), bundleVersion: "2.0.0", toolVersion: "0.2.0", appliedAt: AT, entryRevision: 5 })
    );
    expect(done.state.entry(backed)).toMatchObject({ contentHash: h(3), preImage });
    expect(done.events).toEqual([
      { _tag: "ArtifactInstalled", owner: OWNER, locator: fresh, action: "create", contentHash: h(2), revision: 5 },
      { _tag: "ArtifactInstalled", owner: OWNER, locator: backed, action: "adopt", contentHash: h(3), revision: 5 },
      { _tag: "ArtifactRemoved", owner: OWNER, locator: old, removal: "restore-pre-image", revision: 5 }
    ]);
  });

  it("S32 (domain): refuses a plan built on another revision, a used-up plan, and a ledger with pending work", () => {
    const ledger = restore(snapshot());
    const plan = planOn(ledger, [], { desired: [want(file("a"), 2)] });
    const moved = ledger.acknowledge([], { at: AT });
    const later = restore(snapshot([], { revision: 4 }));
    expect(later.begin(plan, { at: AT, toolVersion: "0.2.0" })).toEqual({
      ok: false,
      error: {
        _tag: "PlanStale",
        planId: "plan-1",
        reason: "ledger-moved",
        basedOn: { ledgerLineage: "lineage-1", ledgerRevision: 3 },
        current: { ledgerLineage: "lineage-1", ledgerRevision: 4 }
      }
    });
    expect(moved.ok && moved.value.state).toBe(ledger);
    const discarded = plan.discard();
    expect(discarded.ok && ledger.begin(discarded.value.state, { at: AT, toolVersion: "0.2.0" })).toMatchObject({
      ok: false,
      error: { _tag: "PlanStale", reason: "discarded" }
    });
    expect(discarded.ok && discarded.value.state.markApplied()).toMatchObject({
      ok: false,
      error: { reason: "discarded" }
    });
    const begun = ledger.begin(plan, { at: AT, toolVersion: "0.2.0" });
    expect(begun.ok && begun.value.state.begin(plan, { at: AT, toolVersion: "0.2.0" })).toMatchObject({
      ok: false,
      error: { _tag: "PlanStale", reason: "ledger-moved" }
    });
    const ready = begun.ok ? restore({ ...begun.value.state.toSnapshot(), revision: 3 }) : ledger;
    expect(ready.begin(plan, { at: AT, toolVersion: "0.2.0" })).toMatchObject({
      ok: false,
      error: { _tag: "PendingOperations" }
    });
  });

  it("keeps the old record of a skipped step and keeps a failed step pending", () => {
    const a = file("a");
    const b = file("b");
    const c = file("c");
    const ledger = restore(snapshot([entry(a)]));
    const plan = planOn(ledger, [{ locator: a, hash: h(1) }], { desired: [want(a, 2), want(b, 3), want(c, 4)] });
    const begun = ledger.begin(plan, { at: AT, toolVersion: "0.2.0" });
    if (!begun.ok) {
      throw new Error("begin failed");
    }
    const all = begun.value.state;
    const done = all.complete(
      [
        { locator: a, status: "skipped" },
        { locator: b, status: "failed" }
      ],
      { at: AT }
    );
    expect(done.state.entry(a)).toEqual(entry(a));
    expect(done.state.entry(b)).toBeUndefined();
    expect(done.state.pending.map((op) => op.locator)).toEqual([b, c]);
    expect(done.events).toEqual([]);
    expect(done.state.complete([{ locator: b, status: "failed" }], { at: AT }).state).toBe(done.state);
    const stray = thrown(() => all.complete([{ locator: file("z"), status: "done" }], { at: AT }));
    expect(isAgentKitError(stray) && stray.code).toBe("unknown-pending-operation");
  });

  it("resolves pending operations from probes instead of replaying them", () => {
    const created = file("created");
    const untouched = file("untouched");
    const changed = file("changed");
    const unprobed = file("unprobed");
    const ledger = restore(snapshot());
    const plan = planOn(ledger, [], {
      desired: [want(created, 2), want(untouched, 3), want(changed, 4), want(unprobed, 5)]
    });
    const begun = ledger.begin(plan, { at: AT, toolVersion: "0.2.0" });
    if (!begun.ok) {
      throw new Error("begin failed");
    }
    const recovered = begun.value.state.recover(
      [{ locator: created, hash: h(2) }, { locator: untouched }, { locator: changed, hash: h(99) }],
      { at: AT }
    );
    expect(recovered.resolutions).toEqual([
      { locator: changed, resolution: "unknown" },
      { locator: created, resolution: "completed" },
      { locator: untouched, resolution: "not-started" }
    ]);
    expect(recovered.state.entries().map((item) => item.locator)).toEqual([created]);
    expect(recovered.state.pending.map((op) => op.locator)).toEqual([unprobed]);
    expect(recovered.state.revision).toBe(5);
  });

  it("hands a released artifact to the remaining owner", () => {
    const shared = file("shared");
    const ledger = restore(snapshot([entry(shared, { owners: [OWNER, "other-app"], activeOwner: OWNER })]));
    const plan = planOn(ledger, [{ locator: shared, hash: h(1) }]);
    const begun = ledger.begin(plan, { at: AT, toolVersion: "0.2.0" });
    if (!begun.ok) {
      throw new Error("begin failed");
    }
    const done = begun.value.state.complete([{ locator: shared, status: "done" }], { at: AT });
    expect(done.state.entry(shared)).toMatchObject({
      owners: ["other-app"],
      activeOwner: "other-app",
      contentHash: h(1)
    });
    expect(done.events).toEqual([
      { _tag: "ArtifactRemoved", owner: OWNER, locator: shared, removal: "release", revision: 5 }
    ]);
  });

  it("answers the owner's entries and the agents they name, its defaults for a change", () => {
    const mine = file("mine");
    const shared = file("shared");
    const theirs = file("theirs");
    const ledger = restore(
      snapshot([
        entry(mine, { agents: ["grok"] }),
        entry(shared, { agents: ["claude-code", "grok"] }),
        entry(theirs, { owners: ["other-app"], activeOwner: "other-app", agents: ["codex"] })
      ])
    );
    expect(ledger.entriesOf(OWNER).map((item) => item.locator)).toEqual([mine, shared]);
    expect(ledger.agentsOf(OWNER)).toEqual(["claude-code", "grok"]);
    expect(ledger.agentsOf("other-app")).toEqual(["codex"]);
    expect(ledger.agentsOf("nobody")).toEqual([]);
  });

  it("acknowledges content the disk already holds, without events, and only for recorded entries", () => {
    const a = file("a");
    const ledger = restore(snapshot([entry(a)]));
    const acknowledged = ledger.acknowledge([{ locator: a, contentHash: h(2) }], { at: AT });
    expect(acknowledged.ok && acknowledged.value).toEqual({
      state: expect.any(Ledger),
      events: []
    });
    expect(acknowledged.ok && acknowledged.value.state.entry(a)).toEqual(
      entry(a, { contentHash: h(2), appliedAt: AT, entryRevision: 4 })
    );
    const unknown = thrown(() => ledger.acknowledge([{ locator: file("b"), contentHash: h(2) }], { at: AT }));
    expect(isAgentKitError(unknown) && unknown.code).toBe("unknown-ledger-entry");
  });

  it("records a forced takeover of a shared entry as the forcing owner's alone, so its uninstall deletes", () => {
    const shared = file("shared");
    const both = restore(snapshot([entry(shared, { owners: [OWNER, "other-app"], activeOwner: "other-app" })]));
    const forced = planOn(both, [{ locator: shared, hash: h(1) }], {
      desired: [want(shared, 2)],
      choices: { [locatorKey(shared)]: "force" }
    });
    const taken = applied(both, forced);
    expect(taken.entry(shared)).toMatchObject({ owners: [OWNER], activeOwner: OWNER, contentHash: h(2) });
    const uninstall = planOn(taken, [{ locator: shared, hash: h(2) }]);
    expect(uninstall.steps).toEqual([expect.objectContaining({ action: "remove", removal: "delete" })]);
  });

  it("narrows a forced takeover to the forcing owner's agents, so its uninstall deletes for agents it never targeted", () => {
    const shared = file("shared");
    const both = restore(
      snapshot([
        entry(shared, { owners: [OWNER, "other-app"], activeOwner: "other-app", agents: ["claude-code", "codex"] })
      ])
    );
    const forced = planOn(both, [{ locator: shared, hash: h(1) }], {
      desired: [want(shared, 2)],
      choices: { [locatorKey(shared)]: "force" }
    });
    const taken = applied(both, forced);
    expect(taken.entry(shared)).toMatchObject({ owners: [OWNER], agents: ["claude-code"], contentHash: h(2) });
    expect(planOn(taken, [{ locator: shared, hash: h(2) }]).steps).toEqual([
      expect.objectContaining({ action: "remove", removal: "delete", agents: [] })
    ]);
  });

  it("converges an uninstall at a dotfiles-managed path: the record goes, the file stays, nothing is left to do", () => {
    const managed = file("managed");
    const ledger = restore(snapshot([entry(managed)]));
    const observed = [{ locator: managed, hash: h(1), managedBy: "chezmoi" }];
    const uninstall = planOn(ledger, observed);
    expect(uninstall.steps).toEqual([
      expect.objectContaining({ action: "remove", removal: "keep", note: "dotfiles-managed" })
    ]);
    const done = applied(ledger, uninstall);
    expect(done.entries()).toEqual([]);
    expect(planOn(done, observed).steps).toEqual([]);
  });

  it("S33 (domain): lets go of a user-modified artifact on uninstall, so a second uninstall has nothing to do", () => {
    const edited = file("edited");
    const ledger = restore(snapshot([entry(edited, { preImage: { existed: true, hash: h(20), blobRef: "blob-20" } })]));
    const observed = [{ locator: edited, hash: h(6) }];
    const uninstall = planOn(ledger, observed);
    const begun = ledger.begin(uninstall, { at: AT, toolVersion: "0.2.0" });
    if (!begun.ok) {
      throw new Error("begin failed");
    }
    const done = begun.value.state.complete([{ locator: edited, status: "done" }], { at: AT });
    expect(done.state.entry(edited)).toBeUndefined();
    expect(done.events).toEqual([
      { _tag: "ArtifactRemoved", owner: OWNER, locator: edited, removal: "keep", revision: 5 }
    ]);
    expect(planOn(done.state, observed).steps).toEqual([]);
    // The ledger remembers that the user kept it, so a legacy marker in it never makes it the owner's to delete.
    expect(done.state.kept(edited)).toEqual({ locator: edited, owner: OWNER, keptAt: AT });
    const withMarker = [{ locator: edited, hash: h(6), content: "agent-presence hook --event Stop" }];
    const markers = { bundle: { ...BUNDLE, legacyMarkers: ["agent-presence hook"] } };
    expect(planOn(done.state, withMarker, markers).steps).toEqual([]);
    // Without that record the same file would be taken for an older version's and deleted.
    expect(planOn(restore(snapshot([])), withMarker, markers).steps).toMatchObject([
      { action: "remove", removal: "delete", legacy: true }
    ]);
  });

  it("resolves pending removals from probes: deleted or restored counts as done, our content still there as not started", () => {
    const deleted = file("deleted");
    const restored = file("restored");
    const untouched = file("untouched");
    const unrestored = file("unrestored");
    const preImage = { existed: true, hash: h(20), blobRef: "blob-20" } as const;
    const ledger = restore(
      snapshot([entry(deleted), entry(restored, { preImage }), entry(untouched), entry(unrestored, { preImage })])
    );
    const uninstall = planOn(
      ledger,
      [deleted, restored, untouched, unrestored].map((locator) => ({ locator, hash: h(1) }))
    );
    const begun = ledger.begin(uninstall, { at: AT, toolVersion: "0.2.0" });
    if (!begun.ok) {
      throw new Error("begin failed");
    }
    const recovered = begun.value.state.recover(
      [
        { locator: deleted },
        { locator: restored, hash: h(20) },
        { locator: untouched, hash: h(1) },
        { locator: unrestored, hash: h(1) }
      ],
      { at: AT }
    );
    expect(recovered.resolutions).toEqual([
      { locator: untouched, resolution: "not-started" },
      { locator: unrestored, resolution: "not-started" },
      { locator: restored, resolution: "completed" },
      { locator: deleted, resolution: "completed" }
    ]);
    expect(recovered.state.entries()).toEqual([entry(untouched), entry(unrestored, { preImage })]);
    expect(recovered.events.map((event) => event._tag === "ArtifactRemoved" && [event.locator, event.removal])).toEqual(
      [
        [restored, "restore-pre-image"],
        [deleted, "delete"]
      ]
    );
    expect(recovered.state.pending).toEqual([]);
  });

  it("refuses to record what a later restore would refuse, so the scope cannot get stuck", () => {
    const a = file("a");
    const ledger = restore(snapshot([entry(a)]));
    const badHash = thrown(() =>
      ledger.acknowledge([{ locator: a, contentHash: "sha256:ABC" as ContentHash }], { at: AT })
    );
    expect(isAgentKitError(badHash) && badHash.code).toBe("invalid-ledger-state");
    const backup = planOn(ledger, [{ locator: file("b"), hash: h(9) }], {
      desired: [want(file("b"), 3)],
      choices: { [locatorKey(file("b"))]: "backup" }
    });
    const badBlob = thrown(() =>
      ledger.begin(backup, {
        at: AT,
        toolVersion: "0.2.0",
        preImages: { [locatorKey(file("b"))]: { existed: true, hash: h(9), blobRef: "" } }
      })
    );
    expect(isAgentKitError(badBlob) && badBlob.code).toBe("invalid-ledger-state");
    expect(
      Ledger.restore({ ...snapshot(), pending: [{ ...pendingOf(backup), resultHash: "sha256:x" as ContentHash }] })
    ).toMatchObject({
      ok: false,
      error: { _tag: "InvalidLedger" }
    });
  });

  it("is frozen together with its data", () => {
    const ledger = restore(snapshot([entry(file("a"))]));
    expect(Object.isFrozen(ledger)).toBe(true);
    expect(Object.isFrozen(ledger.entries()[0]?.owners)).toBe(true);
  });
});
