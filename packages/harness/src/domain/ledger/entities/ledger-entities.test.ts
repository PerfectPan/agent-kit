import { describe, expect, it } from "vite-plus/test";

import { locatorKey } from "../../install-plan/value-objects/artifact-locator.js";
import { Ledger, type LedgerSnapshot } from "../aggregates/ledger.js";
import type { ContentHash } from "../value-objects/content-hash.js";
import { KeptArtifact } from "./kept-artifact.js";
import { LedgerEntry, type LedgerEntrySnapshot } from "./ledger-entry.js";
import { PendingOperation } from "./pending-operation.js";

const hash = (n: number): ContentHash => `sha256:${n.toString(16).padStart(64, "0")}`;
const locator = { kind: "file", path: "/fixture/skill" } as const;
const key = locatorKey(locator);

function snapshot(overrides: Partial<LedgerEntrySnapshot> = {}): LedgerSnapshot {
  return {
    schemaVersion: 1,
    lineage: "fixture",
    revision: 2,
    entries: {
      [key]: {
        locator,
        owners: ["app"],
        activeOwner: "app",
        agents: ["codex", "claude-code"],
        bundleVersion: "1",
        toolVersion: "1",
        contentHash: hash(1),
        preImage: { existed: false },
        appliedAt: "t0",
        entryRevision: 1,
        ...overrides
      }
    },
    pending: [
      {
        planId: "plan",
        owner: "app",
        bundleVersion: "1",
        toolVersion: "1",
        locator,
        action: "update",
        agents: ["codex"],
        precondition: { hash: hash(1) },
        resultHash: hash(2),
        startedAt: "t1"
      }
    ],
    kept: { [key]: { locator, owner: "app", keptAt: "t0" } }
  };
}

function restore(value: LedgerSnapshot): Ledger {
  const restored = Ledger.restore(value);
  if (!restored.ok) {
    throw new Error(JSON.stringify(restored.error));
  }
  return restored.value;
}

describe("Ledger children", () => {
  it("restores immutable entities while snapshots retain only their original data", () => {
    const value = snapshot();
    const ledger = restore(value);
    const entry = ledger.entry(locator);
    const pending = ledger.pending[0];
    const kept = ledger.kept(locator);
    expect(entry).toBeInstanceOf(LedgerEntry);
    expect(pending).toBeInstanceOf(PendingOperation);
    expect(kept).toBeInstanceOf(KeptArtifact);
    expect(entry?.toSnapshot()).toStrictEqual(value.entries[key]);
    expect(pending?.toSnapshot()).toStrictEqual(value.pending[0]);
    expect(kept?.toSnapshot()).toStrictEqual(value.kept?.[key]);
    expect(Object.isFrozen(entry)).toBe(true);
    expect(Object.isFrozen(entry?.owners)).toBe(true);
    expect(Object.isFrozen(pending?.precondition)).toBe(true);
    expect(Object.isFrozen(kept?.locator)).toBe(true);
    expect(ledger.toSnapshot()).toStrictEqual(value);
    expect(JSON.stringify(ledger.toSnapshot())).toBe(JSON.stringify(value));
    const unchanged = ledger.complete([{ locator, status: "failed" }], { at: "t2" });
    expect(unchanged.state).toBe(ledger);
    const completed = ledger.complete([{ locator, status: "done" }], { at: "t2" });
    expect(completed.state.entry(locator)).toBeInstanceOf(LedgerEntry);
    expect(completed.state.toSnapshot().entries[key]).not.toBeInstanceOf(LedgerEntry);
    expect(ledger.entry(locator)?.contentHash).toBe(hash(1));
  });

  it("limits ownership by selected agents and preserves the remaining consumers on release", () => {
    const entry = restore(snapshot()).entry(locator);
    expect(entry?.heldBy("app")).toBe(true);
    expect(entry?.heldBy("other")).toBe(false);
    expect(entry?.heldBy("app", ["codex"])).toBe(true);
    expect(entry?.heldBy("app", ["pi"])).toBe(false);
    expect(entry?.heldBy("app", [])).toBe(false);
    expect(entry?.release("app", ["codex"])).toEqual({ removal: "release", agents: ["claude-code"] });
    expect(entry?.release("app", ["codex", "claude-code"])).toEqual({ removal: "delete", agents: [] });
    const backed = restore(snapshot({ preImage: { existed: true, hash: hash(0), blobRef: "original" } }));
    expect(backed.entry(locator)?.release("app", ["codex", "claude-code"])).toEqual({
      removal: "restore-pre-image",
      agents: []
    });
    const shared = restore(snapshot({ owners: ["app", "other"] }));
    expect(shared.entry(locator)?.release("app", ["codex"])).toEqual({
      removal: "release",
      agents: ["codex", "claude-code"]
    });
  });

  it("sorts and deduplicates the agents of the selected entries", () => {
    const ledger = restore(snapshot({ agents: ["codex", "claude-code", "codex"] }));
    expect(ledger.agentsOf("app")).toEqual(["claude-code", "codex"]);
    expect(ledger.agentsOf("other")).toEqual([]);
    expect(Ledger.unionAgents(["codex", "pi"], ["claude-code", "codex"])).toEqual(["claude-code", "codex", "pi"]);
  });

  it("resolves crash probes without replaying the operation", () => {
    const pending = restore(snapshot()).pending[0];
    expect(pending?.resolve(hash(2))).toBe("completed");
    expect(pending?.resolve(hash(1))).toBe("not-started");
    expect(pending?.resolve(hash(3))).toBe("unknown");
    expect(pending?.resolve(undefined)).toBe("unknown");
  });

  it("completes an ownedAt operation even when its probe differs from the result hash", () => {
    const value = snapshot();
    const ledger = restore({
      ...value,
      pending: value.pending.map((op) => ({ ...op, precondition: { ownedAt: 1 } }))
    });
    expect(ledger.pending[0]?.resolve(hash(3))).toBe("completed");
    expect(ledger.pending[0]?.resolve(undefined)).toBe("completed");
  });

  it.each(["release", "keep"] as const)("completes a %s removal regardless of the disk probe", (removal) => {
    const value = snapshot();
    const ledger = restore({
      ...value,
      pending: value.pending.map((op) => ({ ...op, action: "remove", removal }))
    });
    expect(ledger.pending[0]?.resolve(hash(3))).toBe("completed");
    expect(ledger.pending[0]?.resolve(hash(1))).toBe("completed");
    expect(ledger.pending[0]?.resolve(undefined)).toBe("completed");
  });

  it("leaves every caller-owned child unfrozen when a later invariant rejects the snapshot", () => {
    const value = structuredClone(snapshot());
    const rejected = { ...value, pending: [...value.pending, ...value.pending] };
    expect(Ledger.restore(rejected)).toEqual({
      ok: false,
      error: { _tag: "InvalidLedger", reason: "two pending operations on one locator" }
    });
    const descendants = [
      rejected,
      value.entries,
      ...Object.values(value.entries).flatMap((entry) => [
        entry,
        entry.locator,
        entry.owners,
        entry.agents,
        entry.preImage
      ]),
      rejected.pending,
      ...value.pending.flatMap((op) => [op, op.locator, op.agents, op.precondition]),
      value.kept,
      ...Object.values(value.kept ?? {}).flatMap((kept) => [kept, kept.locator])
    ];
    for (const descendant of descendants) {
      expect(Object.isFrozen(descendant)).toBe(false);
    }
  });

  it("reports a mismatched entry key before invalid owners", () => {
    const value = snapshot({ owners: [] });
    expect(Ledger.restore({ ...value, entries: { wrong: value.entries[key]! } })).toEqual({
      ok: false,
      error: { _tag: "InvalidLedger", reason: "entry is not keyed by its locator", key: "wrong" }
    });
  });

  it("rejects invalid pending and kept children at the root boundary", () => {
    const value = snapshot();
    expect(
      Ledger.restore({ ...value, pending: value.pending.map((op) => ({ ...op, resultHash: "sha256:bad" })) })
    ).toMatchObject({ ok: false, error: { _tag: "InvalidLedger", key } });
    expect(Ledger.restore({ ...value, kept: { [key]: { locator, owner: "", keptAt: "t0" } } })).toMatchObject({
      ok: false,
      error: { _tag: "InvalidLedger", key }
    });
  });
});
