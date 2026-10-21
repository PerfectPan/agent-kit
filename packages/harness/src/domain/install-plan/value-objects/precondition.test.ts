import { describe, expect, it } from "vite-plus/test";

import type { LedgerEntry } from "../../ledger/entities/ledger-entry.js";
import { Ledger } from "../../ledger/aggregates/ledger.js";
import { locatorKey } from "./artifact-locator.js";
import type { ContentHash } from "../../ledger/value-objects/content-hash.js";
import type { ObservedArtifact } from "../spi/observed-artifact.js";
import { PlanStep, type PlanStepSnapshot } from "./plan-step.js";

const hash = (n: number): ContentHash => `sha256:${n.toString(16).padStart(64, "0")}`;

const step = (overrides: Partial<PlanStepSnapshot> = {}): PlanStep => {
  const restored = PlanStep.restore({
    locator: { kind: "file", path: "/u/me/x" },
    action: "create",
    agents: ["claude-code"],
    precondition: { hash: hash(1) },
    capturePreImage: false,
    desired: { hash: hash(1), content: "x" },
    ...overrides
  });
  if (!restored.ok) {
    throw new Error(restored.error);
  }
  return restored.value;
};

function entry(revision: number): LedgerEntry {
  const locator = { kind: "file", path: "/u/me/x" } as const;
  const restored = Ledger.restore({
    schemaVersion: 1,
    lineage: "fixture",
    revision,
    pending: [],
    entries: {
      [locatorKey(locator)]: {
        locator,
        owners: ["app"],
        activeOwner: "app",
        agents: ["codex"],
        bundleVersion: "1",
        toolVersion: "1",
        contentHash: hash(1),
        preImage: { existed: false },
        appliedAt: "t0",
        entryRevision: revision
      }
    }
  });
  if (!restored.ok) {
    throw new Error(restored.error._tag);
  }
  return restored.value.entries()[0]!;
}

const seen = (overrides: Partial<ObservedArtifact> = {}): ObservedArtifact => ({
  locator: { kind: "file", path: "/u/me/x" },
  hash: hash(1),
  ...overrides
});

describe("preconditionSatisfied", () => {
  it("needs the LedgerEntry at the owned-at revision, independently of observation", () => {
    const owned = step({ action: "noop", precondition: { ownedAt: 3 } });
    expect(owned.preconditionSatisfied({ entry: entry(3) })).toBe(true);
    expect(owned.preconditionSatisfied({ entry: entry(4) })).toBe(false);
  });

  it("matches a hash step against the observed hash and an absent step against nothing", () => {
    expect(step().preconditionSatisfied({ observed: seen() })).toBe(true);
    expect(step().preconditionSatisfied({ observed: seen({ hash: hash(2) }) })).toBe(false);
    const absent = step({ action: "remove", precondition: { absent: true }, removal: "delete" });
    expect(absent.preconditionSatisfied({})).toBe(true);
    expect(absent.preconditionSatisfied({ observed: seen() })).toBe(false);
  });
});

describe("targetWritable", () => {
  it("blocks a write that would replace a symlink at the target", () => {
    expect(step().targetWritable(undefined)).toBe(true);
    expect(step().targetWritable(seen({ symlinkTarget: "/elsewhere/x" }))).toBe(false);
    // A step that only changes the ledger is safe even when the target is a symlink.
    expect(
      step({ action: "remove", removal: "release", precondition: { ownedAt: 1 } }).targetWritable(
        seen({
          symlinkTarget: "/elsewhere/x"
        })
      )
    ).toBe(true);
  });
});

describe("preconditionHolds", () => {
  it("holds only when both the precondition matches and the write target is not a symlink", () => {
    expect(step().preconditionHolds({ observed: seen() })).toBe(true);
    expect(step().preconditionHolds({ observed: seen({ hash: hash(2) }) })).toBe(false);
    expect(step().preconditionHolds({ observed: seen({ symlinkTarget: "/x" }) })).toBe(false);
  });
});
