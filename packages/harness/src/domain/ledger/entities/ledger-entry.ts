import { type CodingAgentId, err, ok, type Result } from "@rivus/agent-kit-catalog/public";

import type { InvalidLedger } from "../errors/invalid-ledger.js";
import { locatorProblem } from "../../install-plan/value-objects/artifact-locator.js";
import type { Removal } from "../../install-plan/value-objects/plan-step.js";

import type { Owner } from "../../bundle/value-objects/owner.js";
import type { ArtifactLocator } from "../../install-plan/value-objects/artifact-locator.js";
import { type ContentHash, isContentHash } from "../value-objects/content-hash.js";
import { type PreImage, isPreImage } from "../value-objects/pre-image.js";

/**
 * The Ledger's record of one Artifact. A file shared with other tools is recorded per entry inside it; a whole file
 * only when harness created it or the user adopted it.
 */
export interface LedgerEntrySnapshot {
  readonly locator: ArtifactLocator;
  /** Every owner that installed this content; never empty. Uninstalling one hands the Artifact to the others. */
  readonly owners: readonly Owner[];
  /** The owner whose content is on disk; one of `owners`. */
  readonly activeOwner: Owner;
  /** The agents that use the Artifact, such as several agents reading one skills directory; never empty. */
  readonly agents: readonly CodingAgentId[];
  /** The active owner's bundle version that last recorded it. */
  readonly bundleVersion: string;
  /** The kit version that last wrote it. */
  readonly toolVersion: string;
  readonly contentHash: ContentHash;
  readonly preImage: PreImage;
  /** Positive proof that harness created the containing configuration file; absent means unknown or pre-existing. */
  readonly createdConfigFile?: true;
  readonly appliedAt: string;
  /** The ledger revision that last changed this entry. */
  readonly entryRevision: number;
}

function entryProblem(entry: LedgerEntrySnapshot): string | undefined {
  const locatorIssue = locatorProblem(entry.locator);
  if (locatorIssue !== undefined) {
    return locatorIssue;
  }
  if (entry.owners.length === 0 || new Set(entry.owners).size !== entry.owners.length) {
    return "entry owners are empty or repeated";
  }
  if (!entry.owners.includes(entry.activeOwner)) {
    return "entry's active owner is not one of its owners";
  }
  if (entry.agents.length === 0) {
    return "entry has no agents";
  }
  if (!isContentHash(entry.contentHash) || !isPreImage(entry.preImage)) {
    return "entry has an invalid content hash or pre-image";
  }
  return Number.isSafeInteger(entry.entryRevision) && entry.entryRevision >= 0
    ? undefined
    : "entry revision is not between 0 and the ledger revision";
}

/** A validated, immutable child of the Ledger; only the root restores or replaces it. */
export class LedgerEntry {
  declare readonly locator: ArtifactLocator;
  declare readonly owners: readonly Owner[];
  declare readonly activeOwner: Owner;
  declare readonly agents: readonly CodingAgentId[];
  declare readonly bundleVersion: string;
  declare readonly toolVersion: string;
  declare readonly contentHash: ContentHash;
  declare readonly preImage: PreImage;
  declare readonly createdConfigFile?: true;
  declare readonly appliedAt: string;
  declare readonly entryRevision: number;

  static restore(snapshot: LedgerEntrySnapshot): Result<LedgerEntry, InvalidLedger> {
    const reason = entryProblem(snapshot);
    return reason === undefined ? ok(new LedgerEntry(snapshot)) : err({ _tag: "InvalidLedger", reason });
  }

  readonly #snapshot: LedgerEntrySnapshot;

  private constructor(input: LedgerEntrySnapshot) {
    const snapshot = structuredClone(input);
    Object.freeze(snapshot.locator);
    Object.freeze(snapshot.owners);
    Object.freeze(snapshot.agents);
    Object.freeze(snapshot.preImage);
    this.#snapshot = Object.freeze(snapshot);
    Object.assign(this, snapshot);
    Object.freeze(this);
  }

  toSnapshot(): LedgerEntrySnapshot {
    return this.#snapshot;
  }

  /** An owner's entry is in scope when it names any selected agent; omitting agents includes all its entries. */
  heldBy(owner: Owner, agents?: readonly CodingAgentId[]): boolean {
    return this.owners.includes(owner) && (agents === undefined || this.agents.some((agent) => agents.includes(agent)));
  }

  /**
   * What happens to an entry when its owner stops wanting it for some agents. Other owners keep it whole (their
   * agents are not tracked apart, so none are dropped); otherwise the agents outside the plan keep it; only when nobody
   * uses it does it leave the disk, restoring the pre-image if there was one.
   */
  release(
    owner: Owner,
    agents: readonly CodingAgentId[]
  ): { readonly removal: Removal; readonly agents: readonly CodingAgentId[] } {
    if (this.owners.some((other) => other !== owner)) {
      return { removal: "release", agents: this.agents };
    }
    const remaining = this.agents.filter((agent) => !agents.includes(agent));
    if (remaining.length > 0) {
      return { removal: "release", agents: remaining };
    }
    return { removal: this.preImage.existed ? "restore-pre-image" : "delete", agents: [] };
  }
}
