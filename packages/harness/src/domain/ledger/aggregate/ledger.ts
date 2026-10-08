import { AgentKitError, err, ok, type Result } from "@rivus/agent-kit-catalog";

import type { Owner } from "../../bundle/value-objects/owner.js";
import type { InstallPlan } from "../../install-plan/aggregate/install-plan.js";
import type { PlanStale } from "../../install-plan/errors/plan-stale.js";
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
import { recordOperation } from "../policies/ownership.js";
import { reconcilePending } from "../policies/reconcile.js";
import { type ContentHash, isContentHash } from "../value-objects/content-hash.js";
import type { LedgerEntry } from "../value-objects/ledger-entry.js";
import type {
  PendingOperation,
  PendingProbe,
  PendingResolution,
  StepOutcome
} from "../value-objects/pending-operation.js";
import type { KeptArtifact } from "../value-objects/kept-artifact.js";
import type { PreImage } from "../value-objects/pre-image.js";

export const LEDGER_SCHEMA_VERSION = 1;

export interface LedgerSnapshot {
  readonly schemaVersion: number;
  /** Generated when the ledger is created and never changed, so a ledger recreated elsewhere is told apart. */
  readonly lineage: string;
  /** Increases by one with every change, so a store can refuse a write based on an older revision. */
  readonly revision: number;
  readonly entries: Readonly<Record<LocatorKey, LedgerEntry>>;
  /** Written before any target is touched and cleared once each step's outcome is known. */
  readonly pending: readonly PendingOperation[];
  /** Artifacts kept on removal as the user's, by locator key; absent in a ledger that has none. */
  readonly kept?: Readonly<Record<LocatorKey, KeptArtifact>>;
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
  /** For each step with `capturePreImage`, the copy the store kept of what is at its target. */
  readonly preImages?: Readonly<Record<LocatorKey, PreImage>>;
}

/**
 * Reads only `schemaVersion` of a stored ledger, so that a store checks the version before it parses the rest: a file
 * of an unknown version is refused as it is, never parsed as the current version and never replaced.
 */
export function checkLedgerVersion(stored: unknown): Result<typeof LEDGER_SCHEMA_VERSION, LedgerVersionUnsupported> {
  const schemaVersion =
    typeof stored === "object" && stored !== null ? (stored as { schemaVersion?: unknown }).schemaVersion : undefined;
  return schemaVersion === LEDGER_SCHEMA_VERSION
    ? ok(LEDGER_SCHEMA_VERSION)
    : err({ _tag: "LedgerVersionUnsupported", schemaVersion, supported: [LEDGER_SCHEMA_VERSION] });
}

const isRevision = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;

const isPreImage = (preImage: PreImage): boolean =>
  !preImage.existed ||
  (isContentHash(preImage.hash) && typeof preImage.blobRef === "string" && preImage.blobRef !== "");

function pendingProblem(op: PendingOperation): string | undefined {
  const { precondition } = op;
  const invalid =
    locatorProblem(op.locator) !== undefined ||
    (op.resultHash !== undefined && !isContentHash(op.resultHash)) ||
    (op.preImage !== undefined && !isPreImage(op.preImage)) ||
    ("hash" in precondition && !isContentHash(precondition.hash)) ||
    ("ownedAt" in precondition && !isRevision(precondition.ownedAt));
  return invalid ? "pending operation has an invalid locator, hash, pre-image or precondition" : undefined;
}

function entryProblem(key: string, entry: LedgerEntry, revision: number): string | undefined {
  const locatorIssue = locatorProblem(entry.locator);
  if (locatorIssue !== undefined) {
    return locatorIssue;
  }
  if (key !== locatorKey(entry.locator)) {
    return "entry is not keyed by its locator";
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
  return isRevision(entry.entryRevision) && entry.entryRevision <= revision
    ? undefined
    : "entry revision is not between 0 and the ledger revision";
}

function snapshotProblem(snapshot: LedgerSnapshot): InvalidLedger | undefined {
  const invalid = (reason: string, key?: LocatorKey): InvalidLedger =>
    key === undefined ? { _tag: "InvalidLedger", reason } : { _tag: "InvalidLedger", reason, key };
  if (typeof snapshot.lineage !== "string" || snapshot.lineage === "") {
    return invalid("lineage is empty");
  }
  if (!isRevision(snapshot.revision)) {
    return invalid("revision is not a non-negative integer");
  }
  if (typeof snapshot.entries !== "object" || snapshot.entries === null || !Array.isArray(snapshot.pending)) {
    return invalid("entries or pending are missing");
  }
  for (const [key, entry] of Object.entries(snapshot.entries)) {
    const problem = entryProblem(key, entry, snapshot.revision);
    if (problem !== undefined) {
      return invalid(problem, key);
    }
  }
  for (const op of snapshot.pending) {
    const problem = pendingProblem(op);
    if (problem !== undefined) {
      return invalid(problem, locatorKey(op.locator));
    }
  }
  for (const [key, kept] of Object.entries(snapshot.kept ?? {})) {
    if (locatorProblem(kept.locator) !== undefined || key !== locatorKey(kept.locator) || kept.owner === "") {
      return invalid("a kept Artifact has an invalid locator or no owner", key);
    }
  }
  const pendingKeys = snapshot.pending.map((op) => locatorKey(op.locator));
  return new Set(pendingKeys).size === pendingKeys.length
    ? undefined
    : invalid("two pending operations on one locator");
}

function freeze<T>(value: T): T {
  if (typeof value === "object" && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const inner of Object.values(value)) {
      freeze(inner);
    }
  }
  return value;
}

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
      : ok(new Ledger({ schemaVersion: LEDGER_SCHEMA_VERSION, lineage, revision: 0, entries: {}, pending: [] }));
  }

  static restore(snapshot: LedgerSnapshot): Result<Ledger, LedgerVersionUnsupported | InvalidLedger> {
    const version = checkLedgerVersion(snapshot);
    if (!version.ok) {
      return version;
    }
    const problem = snapshotProblem(snapshot);
    return problem === undefined ? ok(new Ledger(snapshot)) : err(problem);
  }

  private readonly snapshot: LedgerSnapshot;

  private constructor(snapshot: LedgerSnapshot) {
    this.snapshot = freeze(snapshot);
    Object.freeze(this);
  }

  get lineage(): string {
    return this.snapshot.lineage;
  }

  get revision(): number {
    return this.snapshot.revision;
  }

  get pending(): readonly PendingOperation[] {
    return this.snapshot.pending;
  }

  entry(locator: ArtifactLocator): LedgerEntry | undefined {
    const key = locatorKey(locator);
    return Object.hasOwn(this.snapshot.entries, key) ? this.snapshot.entries[key] : undefined;
  }

  entries(): readonly LedgerEntry[] {
    return Object.values(this.snapshot.entries);
  }

  /** The record of an Artifact an owner let go of because the user changed it, if this locator has one. */
  kept(locator: ArtifactLocator, owner?: Owner): KeptArtifact | undefined {
    const key = locatorKey(locator);
    const kept = this.snapshot.kept ?? {};
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
    if (status !== "ready") {
      return err({ _tag: "PlanStale", planId, reason: status, basedOn });
    }
    if (basedOn.ledgerLineage !== this.lineage || basedOn.ledgerRevision !== this.revision) {
      return err({
        _tag: "PlanStale",
        planId,
        reason: "ledger-moved",
        basedOn,
        current: { ledgerLineage: this.lineage, ledgerRevision: this.revision }
      });
    }
    if (this.pending.length > 0) {
      return err({ _tag: "PendingOperations", operations: this.pending });
    }
    const pending = plan.steps.map((step): PendingOperation => {
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
        ...(step.legacy === undefined ? {} : { legacy: step.legacy }),
        startedAt: context.at
      };
    });
    return ok({ state: this.next(this.snapshot.entries, pending), events: [] });
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
      return { op, resolution };
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
      return { op, resolution: probe === undefined ? undefined : reconcilePending(op, probe.hash) };
    });
    return {
      ...this.settle(resolved, context.at),
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
      return err({ _tag: "PendingOperations", operations: this.pending });
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
        entries[locatorKey(locator)] = { ...entry, contentHash, appliedAt: context.at, entryRevision: revision };
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
    resolved: readonly { readonly op: PendingOperation; readonly resolution: PendingResolution | undefined }[],
    at: string
  ): LedgerTransition {
    if (resolved.every(({ resolution }) => resolution === undefined)) {
      return { state: this, events: [] };
    }
    const revision = this.revision + 1;
    const entries: Record<LocatorKey, LedgerEntry> = { ...this.snapshot.entries };
    const kept: Record<LocatorKey, KeptArtifact> = { ...this.snapshot.kept };
    const events: LedgerEvent[] = [];
    for (const { op, resolution } of resolved) {
      if (resolution !== "completed") {
        continue;
      }
      const key = locatorKey(op.locator);
      const recorded = recordOperation(entries[key], op, revision, at);
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
    entries: Readonly<Record<LocatorKey, LedgerEntry>>,
    pending: readonly PendingOperation[],
    kept: Readonly<Record<LocatorKey, KeptArtifact>> = this.snapshot.kept ?? {}
  ): Ledger {
    const { kept: _previous, ...rest } = this.snapshot;
    const snapshot: LedgerSnapshot = {
      ...rest,
      revision: this.revision + 1,
      entries,
      pending,
      ...(Object.keys(kept).length === 0 ? {} : { kept })
    };
    const problem = snapshotProblem(snapshot);
    if (problem !== undefined) {
      throw new AgentKitError("invalid-ledger-state", `A ledger transition would record: ${problem.reason}`, {
        cause: problem
      });
    }
    return new Ledger(snapshot);
  }
}
