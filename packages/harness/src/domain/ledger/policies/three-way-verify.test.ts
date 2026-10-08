import { describe, expect, it } from "vitest";

import { type ArtifactLocator, locatorKey } from "../../install-plan/value-objects/artifact-locator.js";
import type { LedgerEntry } from "../entities/ledger-entry.js";
import type { ContentHash } from "../value-objects/content-hash.js";
import { markAcknowledged, threeWayVerify, verifyOwner } from "./three-way-verify.js";

const L: ContentHash = `sha256:${"1".repeat(64)}`;
const D: ContentHash = `sha256:${"2".repeat(64)}`;
const X: ContentHash = `sha256:${"3".repeat(64)}`;

describe("threeWayVerify", () => {
  it.each([
    ["actual = ledger ≠ desired", { ledger: L, actual: L, desired: D }, "outdated"],
    ["actual ≠ ledger, = desired", { ledger: L, actual: D, desired: D }, "ledger-behind"],
    ["actual differs from both", { ledger: L, actual: X, desired: D }, "user-modified"],
    ["in the ledger, missing on disk", { ledger: L, desired: D }, "deleted-externally"],
    ["not in the ledger, on disk = desired", { actual: D, desired: D }, "adoptable"],
    ["all three equal", { ledger: L, actual: L, desired: L }, "in-sync"],
    ["desired unknown, actual = ledger", { ledger: L, actual: L }, "in-sync"],
    ["desired unknown, actual ≠ ledger", { ledger: L, actual: X }, "user-modified"],
    ["not in the ledger, on disk ≠ desired", { actual: X, desired: D }, "unmanaged"],
    ["nothing recorded or on disk, desired", { desired: D }, "missing"],
    ["nothing anywhere", {}, "in-sync"]
  ] as const)("%s → %s", (_, input, status) => {
    expect(threeWayVerify(input)).toBe(status);
  });
});

const at = (path: string): ArtifactLocator => ({ kind: "file", path: `/u/me/${path}` });

function entry(locator: ArtifactLocator, overrides: Partial<LedgerEntry> = {}): LedgerEntry {
  return {
    locator,
    owners: ["app"],
    activeOwner: "app",
    agents: ["claude-code"],
    bundleVersion: "1.0.0",
    toolVersion: "0.1.0",
    contentHash: L,
    preImage: { existed: false },
    appliedAt: "2026-10-01T00:00:00.000Z",
    entryRevision: 1,
    ...overrides
  };
}

describe("verifyOwner", () => {
  const held = at(".agents/skills/held/SKILL.md");
  const drifted = at(".agents/skills/drifted/SKILL.md");
  const fresh = at(".agents/skills/fresh/SKILL.md");

  it("reports every held entry and collects only the ledger-behind ones for the silent update", () => {
    const entries = [entry(held), entry(drifted)];
    const report = verifyOwner(
      entries,
      new Map([
        [locatorKey(held), L],
        [locatorKey(drifted), D]
      ]),
      [{ locator: drifted, hash: D, agent: "claude-code" }]
    );
    expect(report.artifacts).toEqual([
      { locator: held, agents: ["claude-code"], status: "in-sync" },
      { locator: drifted, agents: ["claude-code"], status: "ledger-behind" }
    ]);
    expect(report.behind).toEqual([{ locator: drifted, contentHash: D }]);
  });

  it("compares a desired Artifact at a locator the owner does not hold as if nothing were recorded", () => {
    const onDisk = verifyOwner([entry(held)], new Map([[locatorKey(fresh), D]]), [
      { locator: fresh, hash: D, agent: "grok" }
    ]);
    expect(onDisk.artifacts[1]).toEqual({ locator: fresh, agents: ["grok"], status: "adoptable" });
    const nowhere = verifyOwner([entry(held)], new Map([[locatorKey(held), L]]), [
      { locator: fresh, hash: D, agent: "grok" }
    ]);
    expect(nowhere.artifacts[1]).toEqual({ locator: fresh, agents: ["grok"], status: "missing" });
  });

  it("merges desired rows that land on one locator: the agents union, the last hash wins", () => {
    const report = verifyOwner([], new Map([[locatorKey(fresh), X]]), [
      { locator: fresh, hash: D, agent: "grok" },
      { locator: fresh, hash: X, agent: "claude-code" }
    ]);
    expect(report.artifacts).toEqual([{ locator: fresh, agents: ["claude-code", "grok"], status: "adoptable" }]);
    expect(report.behind).toEqual([]);
  });
});

describe("markAcknowledged", () => {
  it("reads what the silent update recorded as in-sync and leaves the rest as it was", () => {
    const held = at(".agents/skills/held/SKILL.md");
    const drifted = at(".agents/skills/drifted/SKILL.md");
    const verification = verifyOwner([entry(held), entry(drifted)], new Map([[locatorKey(drifted), D]]), [
      { locator: drifted, hash: D, agent: "claude-code" }
    ]);
    const report = markAcknowledged(
      verification,
      verification.behind.map(({ locator }) => locator)
    );
    expect(report.artifacts).toEqual([
      { locator: held, agents: ["claude-code"], status: "deleted-externally" },
      { locator: drifted, agents: ["claude-code"], status: "in-sync" }
    ]);
    expect(report.behind).toEqual([]);
  });
});
