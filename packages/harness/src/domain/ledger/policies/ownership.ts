import type { CodingAgentId } from "@rivus/agent-kit-catalog";

import type { Owner } from "../../bundle/value-objects/owner.js";
import { locatorKey } from "../../install-plan/value-objects/artifact-locator.js";
import type { Removal } from "../../install-plan/value-objects/plan-step.js";
import type { ArtifactInstalled } from "../events/artifact-installed.js";
import type { ArtifactRemoved } from "../events/artifact-removed.js";
import type { LedgerEntry } from "../value-objects/ledger-entry.js";
import type { PendingOperation } from "../value-objects/pending-operation.js";
import type { PreImage } from "../value-objects/pre-image.js";

export function holds(entry: LedgerEntry, owner: Owner): boolean {
  return entry.owners.includes(owner);
}

const sorted = <T extends string>(values: Iterable<T>): readonly T[] => [...new Set(values)].toSorted();

/** The union of two agent lists, sorted so that equal sets compare equal. */
export function unionAgents(a: readonly CodingAgentId[], b: readonly CodingAgentId[]): readonly CodingAgentId[] {
  return sorted([...a, ...b]);
}

/**
 * What happens to an entry when its owner stops wanting it for some agents. Other owners keep it whole (their
 * agents are not tracked apart, so none are dropped); otherwise the agents outside the plan keep it; only when nobody
 * uses it does it leave the disk, restoring the pre-image if there was one.
 */
export function release(
  entry: LedgerEntry,
  owner: Owner,
  agents: readonly CodingAgentId[]
): { readonly removal: Removal; readonly agents: readonly CodingAgentId[] } {
  if (entry.owners.some((other) => other !== owner)) {
    return { removal: "release", agents: entry.agents };
  }
  const remaining = entry.agents.filter((agent) => !agents.includes(agent));
  if (remaining.length > 0) {
    return { removal: "release", agents: remaining };
  }
  return { removal: entry.preImage.existed ? "restore-pre-image" : "delete", agents: [] };
}

const samePreImage = (a: PreImage, b: PreImage): boolean =>
  a.existed ? b.existed && a.hash === b.hash && a.blobRef === b.blobRef : !b.existed;

const sameList = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((value, index) => value === b[index]);

/** Equal except for when and at which revision it was recorded. */
function sameRecord(a: LedgerEntry, b: LedgerEntry): boolean {
  return (
    a.locator.kind === b.locator.kind &&
    locatorKey(a.locator) === locatorKey(b.locator) &&
    sameList(a.owners, b.owners) &&
    a.activeOwner === b.activeOwner &&
    sameList(a.agents, b.agents) &&
    a.bundleVersion === b.bundleVersion &&
    a.contentHash === b.contentHash &&
    samePreImage(a.preImage, b.preImage)
  );
}

export interface RecordedOperation {
  readonly entry: LedgerEntry | undefined;
  readonly event?: ArtifactInstalled | ArtifactRemoved;
}

/**
 * The entry after a completed operation. The first pre-image stays for the entry's whole life, so uninstall restores
 * what was there before any owner. Owners share only the recorded content: an operation that keeps it adds its owner
 * to the others, one that records different content (such as a forced takeover) leaves its owner as the only one,
 * because the others' content is gone. An operation that changes nothing returns the entry as it was.
 */
export function recordOperation(
  entry: LedgerEntry | undefined,
  op: PendingOperation,
  revision: number,
  at: string
): RecordedOperation {
  if (op.action === "remove") {
    const event: ArtifactRemoved = {
      _tag: "ArtifactRemoved",
      owner: op.owner,
      locator: op.locator,
      removal: op.removal ?? "delete",
      revision
    };
    if (op.removal !== "release" || entry === undefined) {
      return { entry: undefined, event };
    }
    const owners = entry.owners.length > 1 ? entry.owners.filter((owner) => owner !== op.owner) : entry.owners;
    const activeOwner = owners.includes(entry.activeOwner) ? entry.activeOwner : (owners[0] ?? entry.activeOwner);
    return {
      entry: { ...entry, owners, activeOwner, agents: op.agents, appliedAt: at, entryRevision: revision },
      event
    };
  }
  if (op.resultHash === undefined) {
    return { entry };
  }
  const unchanged = entry !== undefined && entry.contentHash === op.resultHash;
  const activeOwner = unchanged ? entry.activeOwner : op.owner;
  const next: LedgerEntry = {
    locator: op.locator,
    owners: unchanged ? sorted([...entry.owners, op.owner]) : [op.owner],
    activeOwner,
    agents: op.agents,
    bundleVersion: activeOwner === op.owner ? op.bundleVersion : (entry?.bundleVersion ?? op.bundleVersion),
    toolVersion: unchanged ? entry.toolVersion : op.toolVersion,
    contentHash: op.resultHash,
    preImage: entry?.preImage ?? op.preImage ?? { existed: false },
    appliedAt: at,
    entryRevision: revision
  };
  if (entry !== undefined && sameRecord(entry, next)) {
    return { entry };
  }
  return op.action === "noop"
    ? { entry: next }
    : {
        entry: next,
        event: {
          _tag: "ArtifactInstalled",
          owner: op.owner,
          locator: op.locator,
          action: op.action,
          contentHash: op.resultHash,
          revision
        }
      };
}
