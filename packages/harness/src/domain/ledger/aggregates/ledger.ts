import { AgentKitError, type CodingAgentId, err, ok, type Result } from "@rivus/agent-kit-catalog/public";

import type { Owner } from "../../bundle/value-objects/owner.js";
import type { InstallPlan } from "../../install-plan/aggregates/install-plan.js";
import { ledgerMovedError, planClosedError, type PlanStale } from "../../install-plan/errors/plan-stale.js";
import { basisMoved } from "../../install-plan/value-objects/plan-basis.js";
import {
  type ArtifactLocator,
  type LocatorKey,
  locatorKey,
  locatorProblem
} from "../../install-plan/value-objects/artifact-locator.js";
import type { InvalidLedger } from "../errors/invalid-ledger.js";
import type { LedgerVersionUnsupported } from "../errors/ledger-version-unsupported.js";
import type { PendingOperations } from "../errors/pending-operations.js";
import type { ArtifactInstalled } from "../events/artifact-installed.js";
import type { ArtifactRemoved } from "../events/artifact-removed.js";
import { type ContentHash } from "../value-objects/content-hash.js";
import { LedgerEntry, type LedgerEntrySnapshot } from "../entities/ledger-entry.js";
import {
  PendingOperation,
  type PendingOperationSnapshot,
  type PendingProbe,
  type PendingResolution,
  type StepOutcome
} from "../entities/pending-operation.js";
import { KeptArtifact, type KeptArtifactSnapshot } from "../entities/kept-artifact.js";
import type { PreImage } from "../value-objects/pre-image.js";

export const LEDGER_SCHEMA_VERSION = 1;

export interface LedgerSnapshot {
  readonly schemaVersion: number;
  /** Generated when the ledger is created and never changed, so a ledger recreated elsewhere is told apart. */
  readonly lineage: string;
  /** Increases by one with every change, so a repository can refuse a write based on an older revision. */
  readonly revision: number;
  readonly entries: Readonly<Record<LocatorKey, LedgerEntrySnapshot>>;
  /** Written before any target is touched and cleared once each step's outcome is known. */
  readonly pending: readonly PendingOperationSnapshot[];
  /** Artifacts kept on removal as the user's, by locator key; absent in a ledger that has none. */
  readonly kept?: Readonly<Record<LocatorKey, KeptArtifactSnapshot>>;
}

export type LedgerEvent = ArtifactInstalled | ArtifactRemoved;

export type LedgerTransition = { readonly state: Ledger; readonly events: readonly LedgerEvent[] };

export type LedgerRecovery = LedgerTransition & {
  readonly resolutions: readonly { readonly locator: ArtifactLocator; readonly resolution: PendingResolution }[];
};

export interface BeginContext {
  /** ISO time, recorded as each operation's start. */
  readonly at: string;
  /** The kit version doing the writes. */
  readonly toolVersion: string;
  /** For each step with `capturePreImage`, the copy the repository kept of what is at its target. */
  readonly preImages?: Readonly<Record<LocatorKey, PreImage>>;
  /** Configuration files known to have been created by harness, including ones this plan is about to create. */
  readonly createdConfigFiles?: readonly string[];
  /** Paths whose existing entries lose proof; new pending entries can independently prove a freshly created file. */
  readonly revokedConfigFiles?: readonly string[];
}

/**
 * Judges the `schemaVersion` of a stored ledger, so that a store checks the version before it parses the rest: a file
 * of an unknown version is refused as it is, never parsed as the current version and never replaced. The stored
 * record arrives with its envelope parsed (the reading layer reads that one field); this judges the version.
 */
export function checkLedgerVersion(stored: {
  readonly schemaVersion: unknown;
}): Result<typeof LEDGER_SCHEMA_VERSION, LedgerVersionUnsupported> {
  const { schemaVersion } = stored;
  return schemaVersion === LEDGER_SCHEMA_VERSION
    ? ok(LEDGER_SCHEMA_VERSION)
    : err({ _tag: "LedgerVersionUnsupported", schemaVersion, supported: [LEDGER_SCHEMA_VERSION] });
}

const samePreImage = (a: PreImage, b: PreImage): boolean =>
  a.existed ? b.existed && a.hash === b.hash && a.blobRef === b.blobRef : !b.existed;

const sameList = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((value, index) => value === b[index]);

/** Equal except for when and at which revision it was recorded. */
function sameRecord(a: LedgerEntrySnapshot, b: LedgerEntrySnapshot): boolean {
  return (
    a.locator.kind === b.locator.kind &&
    locatorKey(a.locator) === locatorKey(b.locator) &&
    sameList(a.owners, b.owners) &&
    a.activeOwner === b.activeOwner &&
    sameList(a.agents, b.agents) &&
    a.bundleVersion === b.bundleVersion &&
    a.contentHash === b.contentHash &&
    a.createdConfigFile === b.createdConfigFile &&
    samePreImage(a.preImage, b.preImage)
  );
}

/** Deep-freeze helper: snapshots retain no mutable descendants. */
function freeze<T>(value: T): T {
  if (typeof value === "object" && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const inner of Object.values(value)) {
      freeze(inner);
    }
  }
  return value;
}
const isRevision = (value: number): boolean => Number.isSafeInteger(value) && value >= 0;

/**
 * The local record of what harness installed in one scope. Every change returns a new Ledger one revision ahead; a
 * store writes it under the LedgerLock, compares revisions, and never writes over a ledger whose version it does not
 * know. A Ledger deep-freezes the data it is given, and `toSnapshot` returns that frozen data.
 */
export class Ledger {
  /** A new, empty ledger; only for a scope that has none stored. */
  static create(lineage: string): Result<Ledger, InvalidLedger> {
    return lineage === ""
      ? err({ _tag: "InvalidLedger", reason: "lineage is empty" })
      : ok(
          new Ledger(
            { schemaVersion: LEDGER_SCHEMA_VERSION, lineage, revision: 0, entries: {}, pending: [] },
            {},
            [],
            {}
          )
        );
  }

  static restore(snapshot: LedgerSnapshot): Result<Ledger, LedgerVersionUnsupported | InvalidLedger> {
    const version = checkLedgerVersion(snapshot);
    if (!version.ok) {
      return version;
    }
    const invalid = (reason: string, key?: LocatorKey): Result<never, InvalidLedger> =>
      err(key === undefined ? { _tag: "InvalidLedger", reason } : { _tag: "InvalidLedger", reason, key });
    if (snapshot.lineage === "") {
      return invalid("lineage is empty");
    }
    if (!isRevision(snapshot.revision)) {
      return invalid("revision is not a non-negative integer");
    }
    const entries: Record<LocatorKey, LedgerEntry> = {};
    for (const [key, value] of Object.entries(snapshot.entries)) {
      const locatorIssue = locatorProblem(value.locator);
      if (locatorIssue !== undefined) {
        return invalid(locatorIssue, key);
      }
      if (key !== locatorKey(value.locator)) {
        return invalid("entry is not keyed by its locator", key);
      }
      const entry = LedgerEntry.restore(value);
      if (!entry.ok) {
        return invalid(entry.error.reason, key);
      }
      if (entry.value.entryRevision > snapshot.revision) {
        return invalid("entry revision is not between 0 and the ledger revision", key);
      }
      entries[key] = entry.value;
    }
    const pending: PendingOperation[] = [];
    for (const value of snapshot.pending) {
      const op = PendingOperation.restore(value);
      if (!op.ok) {
        return invalid(op.error.reason, locatorKey(value.locator));
      }
      pending.push(op.value);
    }
    const kept: Record<LocatorKey, KeptArtifact> = {};
    for (const [key, value] of Object.entries(snapshot.kept ?? {})) {
      const artifact = KeptArtifact.restore(value);
      if (!artifact.ok) {
        return invalid(artifact.error.reason, key);
      }
      if (key !== locatorKey(value.locator)) {
        return invalid("a kept Artifact has an invalid locator or no owner", key);
      }
      kept[key] = artifact.value;
    }
    if (new Set(pending.map((op) => locatorKey(op.locator))).size !== pending.length) {
      return invalid("two pending operations on one locator");
    }
    return ok(new Ledger(snapshot, entries, pending, kept));
  }

  /** The union of two agent lists, sorted so that equal sets compare equal. */
  static unionAgents(a: readonly CodingAgentId[], b: readonly CodingAgentId[]): readonly CodingAgentId[] {
    return [...new Set([...a, ...b])].toSorted();
  }

  /** Every agent these entries name, without repeats and sorted. */
  private static agentsOfEntries(entries: readonly LedgerEntry[]): readonly CodingAgentId[] {
    return [...new Set(entries.flatMap((entry) => entry.agents))].toSorted();
  }

  private readonly snapshot: LedgerSnapshot;
  private readonly entriesByKey: Readonly<Record<LocatorKey, LedgerEntry>>;
  private readonly pendingOperations: readonly PendingOperation[];
  private readonly keptByKey: Readonly<Record<LocatorKey, KeptArtifact>>;

  private constructor(
    snapshot: LedgerSnapshot,
    entries: Readonly<Record<LocatorKey, LedgerEntry>>,
    pending: readonly PendingOperation[],
    kept: Readonly<Record<LocatorKey, KeptArtifact>>
  ) {
    this.snapshot = freeze(snapshot);
    this.entriesByKey = freeze(entries);
    this.pendingOperations = freeze(pending);
    this.keptByKey = freeze(kept);
    Object.freeze(this);
  }

  get lineage(): string {
    return this.snapshot.lineage;
  }

  get revision(): number {
    return this.snapshot.revision;
  }

  get pending(): readonly PendingOperation[] {
    return this.pendingOperations;
  }

  entry(locator: ArtifactLocator): LedgerEntry | undefined {
    const key = locatorKey(locator);
    return Object.hasOwn(this.entriesByKey, key) ? this.entriesByKey[key] : undefined;
  }

  entries(): readonly LedgerEntry[] {
    return Object.values(this.entriesByKey);
  }

  /** The entries whose owners include `owner`, in ledger order. */
  entriesOf(owner: Owner): readonly LedgerEntry[] {
    return this.entries().filter((entry) => entry.heldBy(owner));
  }

  /** Every agent the owner's entries name, without repeats and sorted; the default agents a change covers. */
  agentsOf(owner: Owner): readonly CodingAgentId[] {
    return Ledger.agentsOfEntries(this.entriesOf(owner));
  }

  /** Artifacts kept on removal, keyed by locator. Empty when the snapshot omits `kept`. */
  keptRecords(): Readonly<Record<LocatorKey, KeptArtifact>> {
    return this.keptByKey;
  }

  /** The record of an Artifact an owner let go of because the user changed it, if this locator has one. */
  kept(locator: ArtifactLocator, owner?: Owner): KeptArtifact | undefined {
    const key = locatorKey(locator);
    const kept = this.keptByKey;
    if (Object.hasOwn(kept, key) && (owner === undefined || kept[key]?.owner === owner)) {
      return kept[key];
    }
    // A command is its hook's locator member, so editing it changes the key. Preserve the whole event's protection.
    return locator.memberIn === "hook-group"
      ? Object.values(kept).find(
          (record) =>
            (owner === undefined || record.owner === owner) &&
            record.locator.memberIn === "hook-group" &&
            record.locator.path === locator.path &&
            record.locator.pointer === locator.pointer
        )
      : undefined;
  }

  /**
   * Records every step of a plan as pending, before any target is touched. A plan that is no longer ready, or that
   * was built on another lineage or revision, is stale; a ledger with unfinished operations must `recover` first.
   */
  begin(plan: InstallPlan, context: BeginContext): Result<LedgerTransition, PlanStale | PendingOperations> {
    const { basedOn, planId, status } = plan;
    const closed = planClosedError({ planId, status, basedOn });
    if (closed !== undefined) {
      return err(closed);
    }
    if (basisMoved(basedOn, this)) {
      return err(ledgerMovedError(planId, basedOn, this));
    }
    if (this.pending.length > 0) {
      return err({ _tag: "PendingOperations", operations: this.snapshot.pending });
    }
    const pending = plan.steps.map((step): PendingOperationSnapshot => {
      const key = locatorKey(step.locator);
      if (step.action === "conflict") {
        throw new AgentKitError("unresolved-conflict", `Plan step ${key} is an unresolved conflict`);
      }
      const preImage = step.capturePreImage
        ? context.preImages?.[key]
        : step.removal === "restore-pre-image"
          ? this.entry(step.locator)?.preImage
          : undefined;
      if (
        step.capturePreImage &&
        !(preImage?.existed === true && "hash" in step.precondition && preImage.hash === step.precondition.hash)
      ) {
        throw new AgentKitError("pre-image-missing", `No pre-image matching the precondition was captured for ${key}`);
      }
      return {
        planId,
        owner: plan.bundle.owner,
        bundleVersion: plan.bundle.version,
        toolVersion: context.toolVersion,
        locator: step.locator,
        action: step.action,
        agents: step.agents,
        precondition: step.precondition,
        ...(step.desired === undefined ? {} : { resultHash: step.desired.hash }),
        ...(step.removal === undefined ? {} : { removal: step.removal }),
        ...(preImage === undefined ? {} : { preImage }),
        ...((step.locator.kind === "json-entry" || step.locator.kind === "toml-entry") &&
        context.createdConfigFiles?.includes(step.locator.path) === true
          ? { createdConfigFile: true }
          : {}),
        ...(step.legacy === undefined ? {} : { legacy: step.legacy }),
        startedAt: context.at
      };
    });
    const entries = Object.fromEntries(
      Object.entries(this.snapshot.entries).map(([key, entry]) => {
        if (entry.createdConfigFile !== true || context.revokedConfigFiles?.includes(entry.locator.path) !== true) {
          return [key, entry];
        }
        // Clear proof before pending is saved, including entries outside this plan, so completion and recovery
        // cannot inherit it from an old owner. The pending plan still checks its original ownership revision.
        const { createdConfigFile: _revoked, ...unproven } = entry;
        return [key, { ...unproven, entryRevision: this.revision + 1 }];
      })
    );
    return ok({ state: this.next(entries, pending), events: [] });
  }

  /**
   * Records how each pending step finished: a `done` step's record is written and its operation cleared; a `skipped`
   * step keeps its old record; a `failed` step, or one without an outcome, stays pending for `recover` to probe.
   */
  complete(outcomes: readonly StepOutcome[], context: { readonly at: string }): LedgerTransition {
    const byKey = new Map(outcomes.map((outcome) => [locatorKey(outcome.locator), outcome.status]));
    const resolved = this.pending.map((op) => {
      const status = byKey.get(locatorKey(op.locator));
      byKey.delete(locatorKey(op.locator));
      const resolution: PendingResolution | undefined =
        status === "done" ? "completed" : status === "skipped" ? "not-started" : undefined;
      return { op: op.toSnapshot(), resolution };
    });
    const [stray] = byKey.keys();
    if (stray !== undefined) {
      throw new AgentKitError("unknown-pending-operation", `No pending operation for outcome ${stray}`);
    }
    return this.settle(resolved, context.at);
  }

  /**
   * After an interrupted modification, resolves each pending operation from a probe of its target instead of
   * replaying it. An operation without a probe stays pending.
   */
  recover(probes: readonly PendingProbe[], context: { readonly at: string }): LedgerRecovery {
    const byKey = new Map(probes.map((probe) => [locatorKey(probe.locator), probe]));
    const resolved = this.pending.map((op) => {
      const probe = byKey.get(locatorKey(op.locator));
      // A matching entry cannot prove who created its file between pending and recovery. Only already committed
      // provenance may survive; recordOperation retains it from the existing entry.
      const { createdConfigFile: _unconfirmed, ...recovered } = op.toSnapshot();
      return { op: recovered, resolution: probe === undefined ? undefined : op.resolve(probe.hash) };
    });
    return {
      ...this.settle(resolved, context.at, true),
      resolutions: resolved.flatMap(({ op, resolution }) =>
        resolution === undefined ? [] : [{ locator: op.locator, resolution }]
      )
    };
  }

  /**
   * The silent update of three-way verify: the disk already holds the desired content, so the ledger records its
   * hash. Unknown locators are a caller error.
   */
  acknowledge(
    updates: readonly { readonly locator: ArtifactLocator; readonly contentHash: ContentHash }[],
    context: { readonly at: string }
  ): Result<LedgerTransition, PendingOperations> {
    if (this.pending.length > 0) {
      return err({ _tag: "PendingOperations", operations: this.snapshot.pending });
    }
    const revision = this.revision + 1;
    const entries = { ...this.snapshot.entries };
    let changed = false;
    for (const { locator, contentHash } of updates) {
      const entry = this.entry(locator);
      if (entry === undefined) {
        throw new AgentKitError("unknown-ledger-entry", `No ledger entry for ${locatorKey(locator)}`);
      }
      if (entry.contentHash !== contentHash) {
        // Observing new content proves no file creation; only unchanged entries can keep that proof.
        const { createdConfigFile: _unconfirmed, ...unproven } = entry.toSnapshot();
        entries[locatorKey(locator)] = { ...unproven, contentHash, appliedAt: context.at, entryRevision: revision };
        changed = true;
      }
    }
    return ok({ state: changed ? this.next(entries, []) : this, events: [] });
  }

  toSnapshot(): LedgerSnapshot {
    return this.snapshot;
  }

  /** Clears resolved operations and writes the records of completed ones; without any resolution nothing changes. */
  private settle(
    resolved: readonly { readonly op: PendingOperationSnapshot; readonly resolution: PendingResolution | undefined }[],
    at: string,
    recovering = false
  ): LedgerTransition {
    if (resolved.every(({ resolution }) => resolution === undefined)) {
      return { state: this, events: [] };
    }
    const revision = this.revision + 1;
    const entries: Record<LocatorKey, LedgerEntrySnapshot> = { ...this.snapshot.entries };
    const kept: Record<LocatorKey, KeptArtifactSnapshot> = { ...this.snapshot.kept };
    const events: LedgerEvent[] = [];
    for (const { op, resolution } of resolved) {
      if (resolution !== "completed") {
        continue;
      }
      const key = locatorKey(op.locator);
      let previous = entries[key];
      if (
        recovering &&
        previous?.createdConfigFile === true &&
        op.resultHash !== undefined &&
        previous.contentHash !== op.resultHash
      ) {
        // A probe cannot transfer an old file's creation proof to different content left by an unknown writer.
        const { createdConfigFile: _unconfirmed, ...unproven } = previous;
        previous = unproven;
      }
      const recorded = this.recordOperation(previous, op, revision, at);
      if (recorded.entry === undefined) {
        delete entries[key];
      } else {
        entries[key] = recorded.entry;
        delete kept[key];
      }
      if (
        op.action === "remove" &&
        (op.removal === "keep" || (op.locator.memberIn === "hook-group" && "absent" in op.precondition))
      ) {
        kept[key] = { locator: op.locator, owner: op.owner, keptAt: at };
      }
      if (recorded.event !== undefined) {
        events.push(recorded.event);
      }
    }
    const pending = resolved.flatMap(({ op, resolution }) => (resolution === undefined ? [op] : []));
    return { state: this.next(entries, pending, kept), events };
  }

  /**
   * The next revision. It is checked like a restored snapshot, so that no transition records something a later
   * `restore` would refuse, which would leave the scope unusable; bad input from the caller is a defect.
   */
  private next(
    entries: Readonly<Record<LocatorKey, LedgerEntrySnapshot>>,
    pending: readonly PendingOperationSnapshot[],
    kept: Readonly<Record<LocatorKey, KeptArtifactSnapshot>> = this.snapshot.kept ?? {}
  ): Ledger {
    const { kept: _previous, ...rest } = this.snapshot;
    const snapshot: LedgerSnapshot = {
      ...rest,
      revision: this.revision + 1,
      entries,
      pending,
      ...(Object.keys(kept).length === 0 ? {} : { kept })
    };
    const restored = Ledger.restore(snapshot);
    if (!restored.ok) {
      throw new AgentKitError(
        "invalid-ledger-state",
        `A ledger transition would record: ${restored.error._tag === "InvalidLedger" ? restored.error.reason : "unsupported version"}`,
        {
          cause: restored.error
        }
      );
    }
    return restored.value;
  }
  /**
   * The entry after a completed operation. The first pre-image stays for the entry's whole life, so uninstall restores
   * what was there before any owner. Owners share only the recorded content: an operation that keeps it adds its owner
   * to the others, one that records different content (such as a forced takeover) leaves its owner as the only one,
   * because the others' content is gone. An operation that changes nothing returns the entry as it was.
   */
  private recordOperation(
    entry: LedgerEntrySnapshot | undefined,
    op: PendingOperationSnapshot,
    revision: number,
    at: string
  ): { readonly entry: LedgerEntrySnapshot | undefined; readonly event?: LedgerEvent } {
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
    const next: LedgerEntrySnapshot = {
      locator: op.locator,
      owners: unchanged ? [...new Set([...entry.owners, op.owner])].toSorted() : [op.owner],
      activeOwner,
      agents: op.agents,
      bundleVersion: activeOwner === op.owner ? op.bundleVersion : (entry?.bundleVersion ?? op.bundleVersion),
      toolVersion: unchanged ? entry.toolVersion : op.toolVersion,
      contentHash: op.resultHash,
      preImage: entry?.preImage ?? op.preImage ?? { existed: false },
      ...(entry?.createdConfigFile === true || op.createdConfigFile === true ? { createdConfigFile: true } : {}),
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
}
