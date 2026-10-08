import { describe, expect, it } from "vitest";

import type { LedgerEntry } from "../../ledger/entities/ledger-entry.js";
import type { ContentHash } from "../../ledger/value-objects/content-hash.js";
import type { ObservedArtifact } from "./observed-artifact.js";
import type { PlanStep } from "./plan-step.js";
import { preconditionHolds, preconditionSatisfied, targetWritable } from "./precondition.js";

const hash = (n: number): ContentHash => `sha256:${n.toString(16).padStart(64, "0")}`;

const step = (overrides: Partial<PlanStep> = {}): PlanStep => ({
  locator: { kind: "file", path: "/u/me/x" },
  action: "create",
  agents: ["claude-code"],
  precondition: { hash: hash(1) },
  capturePreImage: false,
  ...overrides
});

const entry = (revision: number): LedgerEntry => ({ entryRevision: revision }) as unknown as LedgerEntry;

const seen = (overrides: Partial<ObservedArtifact> = {}): ObservedArtifact => ({
  locator: { kind: "file", path: "/u/me/x" },
  hash: hash(1),
  ...overrides
});

describe("preconditionSatisfied", () => {
  it("needs the LedgerEntry at the owned-at revision, independently of observation", () => {
    const owned = step({ action: "noop", precondition: { ownedAt: 3 } });
    expect(preconditionSatisfied(owned, { entry: entry(3) })).toBe(true);
    expect(preconditionSatisfied(owned, { entry: entry(4) })).toBe(false);
  });

  it("matches a hash step against the observed hash and an absent step against nothing", () => {
    expect(preconditionSatisfied(step(), { observed: seen() })).toBe(true);
    expect(preconditionSatisfied(step(), { observed: seen({ hash: hash(2) }) })).toBe(false);
    const absent = step({ action: "remove", precondition: { absent: true }, removal: "delete" });
    expect(preconditionSatisfied(absent, {})).toBe(true);
    expect(preconditionSatisfied(absent, { observed: seen() })).toBe(false);
  });
});

describe("targetWritable", () => {
  it("blocks a write that would replace a symlink at the target", () => {
    expect(targetWritable(step(), undefined)).toBe(true);
    expect(targetWritable(step(), seen({ symlinkTarget: "/elsewhere/x" }))).toBe(false);
    // A step that only changes the ledger is safe even when the target is a symlink.
    expect(
      targetWritable(
        step({ action: "remove", removal: "release", precondition: { ownedAt: 1 } }),
        seen({
          symlinkTarget: "/elsewhere/x"
        })
      )
    ).toBe(true);
  });
});

describe("preconditionHolds", () => {
  it("holds only when both the precondition matches and the write target is not a symlink", () => {
    expect(preconditionHolds(step(), { observed: seen() })).toBe(true);
    expect(preconditionHolds(step(), { observed: seen({ hash: hash(2) }) })).toBe(false);
    expect(preconditionHolds(step(), { observed: seen({ symlinkTarget: "/x" }) })).toBe(false);
  });
});
