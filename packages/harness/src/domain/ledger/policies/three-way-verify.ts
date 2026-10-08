import type { CodingAgentId } from "@rivus/agent-kit-catalog";

import {
  type ArtifactLocator,
  type LocatorKey,
  locatorKey
} from "../../install-plan/value-objects/artifact-locator.js";
import type { LedgerEntry } from "../entities/ledger-entry.js";
import type { ContentHash } from "../value-objects/content-hash.js";
import type { VerifyStatus } from "../value-objects/drift.js";
import { unionAgents } from "./ownership.js";

export interface VerifyInput {
  /** The LedgerEntry's contentHash; absent when the ledger has no entry. */
  readonly ledger?: ContentHash;
  /** What is on disk; absent when nothing is there. */
  readonly actual?: ContentHash;
  /** What the bundle wants; absent when it wants nothing there, or when the caller does not know. */
  readonly desired?: ContentHash;
}

/**
 * Compares the disk with both the ledger and the desired content, the way chezmoi does, so that a change made after
 * harness wrote is told apart from a change harness has yet to make:
 *
 * | ledger | disk | desired | status |
 * | --- | --- | --- | --- |
 * | L | = L | = L or unknown | in-sync |
 * | L | = L | ≠ L | outdated |
 * | L | ≠ L | = disk | ledger-behind (update the ledger silently) |
 * | L | ≠ L | ≠ disk or unknown | user-modified |
 * | L | none | any | deleted-externally |
 * | none | X | = X | adoptable |
 * | none | X | ≠ X or none | unmanaged |
 * | none | none | D | missing |
 * | none | none | none | in-sync |
 */
export function threeWayVerify({ ledger, actual, desired }: VerifyInput): VerifyStatus {
  if (ledger === undefined) {
    if (actual === undefined) {
      return desired === undefined ? "in-sync" : "missing";
    }
    return actual === desired ? "adoptable" : "unmanaged";
  }
  if (actual === undefined) {
    return "deleted-externally";
  }
  if (actual === ledger) {
    return desired === undefined || desired === ledger ? "in-sync" : "outdated";
  }
  return actual === desired ? "ledger-behind" : "user-modified";
}

/** One Artifact as the verify of an Owner's entries reports it: the ledger's record, the disk, the desired content. */
export interface VerifiedArtifact {
  readonly locator: ArtifactLocator;
  readonly agents: readonly CodingAgentId[];
  readonly status: VerifyStatus;
}

/** The verify of one Owner's Artifacts: every Artifact's status, and the records the disk runs ahead of. */
export interface OwnerVerification {
  readonly artifacts: readonly VerifiedArtifact[];
  /** The `ledger-behind` Artifacts, whose hash `Ledger.acknowledge` records. */
  readonly behind: readonly { readonly locator: ArtifactLocator; readonly contentHash: ContentHash }[];
}

/**
 * The three-way verify of one Owner's Artifacts, the classification `verify` reports: every entry the owner holds is
 * compared with the disk and, when the bundle wants something there, with it; a desired Artifact at a locator no held
 * entry covers is compared as if nothing were recorded. Rows of `desired` that land on one locator are merged — the
 * agents union, the last hash wins — because verify reports a state, where `buildInstallPlan` would refuse the same
 * input as `conflicting-desired`. Only `ledger-behind` Artifacts go into `behind`, the ones the silent update records.
 */
export function verifyOwner(
  entries: readonly LedgerEntry[],
  observed: ReadonlyMap<LocatorKey, ContentHash>,
  desired: readonly {
    readonly locator: ArtifactLocator;
    readonly hash: ContentHash;
    readonly agent: CodingAgentId;
  }[]
): OwnerVerification {
  const wanted = new Map<
    LocatorKey,
    { readonly locator: ArtifactLocator; readonly hash: ContentHash; readonly agents: readonly CodingAgentId[] }
  >();
  for (const want of desired) {
    const key = locatorKey(want.locator);
    const known = wanted.get(key);
    wanted.set(key, { locator: want.locator, hash: want.hash, agents: unionAgents(known?.agents ?? [], [want.agent]) });
  }
  const held = new Set(entries.map((entry) => locatorKey(entry.locator)));
  const artifacts: VerifiedArtifact[] = [];
  const behind: { readonly locator: ArtifactLocator; readonly contentHash: ContentHash }[] = [];
  for (const entry of entries) {
    const key = locatorKey(entry.locator);
    const actual = observed.get(key);
    const want = wanted.get(key);
    const status = threeWayVerify({
      ledger: entry.contentHash,
      ...(actual === undefined ? {} : { actual }),
      ...(want === undefined ? {} : { desired: want.hash })
    });
    artifacts.push({ locator: entry.locator, agents: entry.agents, status });
    if (status === "ledger-behind" && actual !== undefined) {
      behind.push({ locator: entry.locator, contentHash: actual });
    }
  }
  for (const [key, want] of wanted) {
    if (held.has(key)) {
      continue;
    }
    const actual = observed.get(key);
    artifacts.push({
      locator: want.locator,
      agents: want.agents,
      status: threeWayVerify({ ...(actual === undefined ? {} : { actual }), desired: want.hash })
    });
  }
  return { artifacts, behind };
}

/** The verification once the silent update recorded the disk's hashes: what was acknowledged reads as in-sync and no longer runs behind. */
export function markAcknowledged(
  verification: OwnerVerification,
  acknowledged: readonly ArtifactLocator[]
): OwnerVerification {
  const updated = new Set(acknowledged.map(locatorKey));
  return {
    artifacts: verification.artifacts.map((artifact) =>
      updated.has(locatorKey(artifact.locator)) ? { ...artifact, status: "in-sync" as const } : artifact
    ),
    behind: verification.behind.filter(({ locator }) => !updated.has(locatorKey(locator)))
  };
}
