import { err, ok, type Result } from "@rivus/agent-kit/catalog";

import type { LeaseHeld } from "../errors/lease-held.js";
import type { LeaseLost } from "../errors/lease-lost.js";
import type { LeaseRecordInvalid } from "../errors/lease-record-invalid.js";
import type { LeaseEvent } from "../events/lease-events.js";
import { Holder, type HolderLiveness } from "../value-objects/holder.js";
import { FencingToken } from "../value-objects/fencing-token.js";
import type { LeaseHolding, LeaseSnapshot } from "../value-objects/lease-snapshot.js";

/** What the observer found out about the current holder before trying to acquire. */
export interface AcquisitionView {
  /** `isFresh` for the record as read. */
  readonly fresh: boolean;
  /** `Holder.liveness` for its holder; irrelevant for a tombstone. */
  readonly liveness: HolderLiveness;
}

/**
 * When an observer last saw a lease record change. Monotonic clocks of two processes cannot be compared, so each
 * observer times a revision from the moment it first read it, as client-go's leader election does.
 */
export interface LeaseObservation {
  readonly revision: number;
  /** The observer's monotonic time when it first read `revision`. */
  readonly observedAt: number;
}

/** One acquisition attempt: who asks, and the wall-clock time recorded for diagnostics. */
export interface LeaseClaim {
  readonly key: string;
  readonly holder: Holder;
  readonly holderId: string;
  readonly now: number;
}

export type LeaseTransition = { readonly state: Lease; readonly events: readonly LeaseEvent[] };

function acquired(snapshot: LeaseSnapshot, previousHolderId: string | null): LeaseEvent {
  const { key, generation, holderId } = snapshot;
  return { _tag: "LeaseAcquired", key, generation, holderId: holderId ?? "", previousHolderId };
}

function invalidity(snapshot: LeaseSnapshot): string | undefined {
  const tokenProblem = FencingToken.problem(snapshot);
  if (tokenProblem !== undefined) {
    return tokenProblem;
  }
  if (!Number.isSafeInteger(snapshot.revision) || snapshot.revision < snapshot.generation) {
    return `revision ${snapshot.revision} is not an integer at least as large as the generation`;
  }
  if ((snapshot.holder === null) !== (snapshot.holderId === null)) {
    return "a holder and a holder id come together";
  }
  if (!Number.isFinite(snapshot.renewedAt)) {
    return "renewedAt is not a number";
  }
  return snapshot.holder === null ? undefined : Holder.problem(snapshot.holder);
}

/**
 * One key's lease. It has one holder at a time; its generation never decreases, release included, because release
 * keeps the record as a tombstone; every write increases its revision. Stores persist the snapshot and compare
 * revisions, so a transition only takes effect when no other writer got there first.
 */
export class Lease {
  /** The first acquisition of a key that has no record. */
  static create(claim: LeaseClaim): LeaseTransition {
    const { generation } = FencingToken.next(claim.key);
    const state = new Lease({
      key: claim.key,
      generation,
      revision: 1,
      holder: claim.holder.toSnapshot(),
      holderId: claim.holderId,
      renewedAt: claim.now
    });
    return { state, events: [acquired(state.snapshot, null)] };
  }

  static restore(snapshot: LeaseSnapshot): Result<Lease, LeaseRecordInvalid> {
    const problem = invalidity(snapshot);
    if (problem !== undefined) {
      return err({ _tag: "LeaseRecordInvalid", key: snapshot.key, message: problem });
    }
    return ok(new Lease(snapshot));
  }

  private readonly snapshot: LeaseSnapshot;
  private readonly token: FencingToken;
  readonly holder: Holder | null;

  // A plain field instead of a parameter property: Node runs this file without a compile step in the cross-process
  // tests, and its type stripping supports only erasable syntax.
  private constructor(snapshot: LeaseSnapshot) {
    this.token = new FencingToken(snapshot);
    this.holder = snapshot.holder === null ? null : new Holder(snapshot.holder);
    this.snapshot = Object.freeze({
      ...snapshot,
      holder: this.holder === null ? null : Object.freeze(this.holder.toSnapshot())
    });
    Object.freeze(this);
  }

  /** Takes the lease when `canAcquire` allows it; the generation moves to the next fencing token. */
  acquire(claim: LeaseClaim, view: AcquisitionView): Result<LeaseTransition, LeaseHeld> {
    const { holder, holderId, generation, key } = this.snapshot;
    if (holder !== null && holderId !== null && !Lease.canAcquire(this, view)) {
      return err({ _tag: "LeaseHeld", key, generation, holder, holderId });
    }
    const state = new Lease({
      key,
      generation: FencingToken.next(key, this.token).generation,
      revision: this.snapshot.revision + 1,
      holder: claim.holder.toSnapshot(),
      holderId: claim.holderId,
      renewedAt: claim.now
    });
    return ok({ state, events: [acquired(state.snapshot, holderId)] });
  }

  /** A heartbeat: only the holding acquisition renews, and the generation stays. */
  renew(holding: LeaseHolding, now: number): Result<LeaseTransition, LeaseLost> {
    const lost = this.lossOf(holding);
    if (lost !== undefined) {
      return err(lost);
    }
    const state = new Lease({ ...this.snapshot, revision: this.snapshot.revision + 1, renewedAt: now });
    const { key, generation, revision } = state.snapshot;
    return ok({ state, events: [{ _tag: "LeaseRenewed", key, generation, revision }] });
  }

  /** Leaves a tombstone: no holder, the same generation, so the next acquisition still moves forward. */
  release(holding: LeaseHolding, now: number): Result<LeaseTransition, LeaseLost> {
    const lost = this.lossOf(holding);
    if (lost !== undefined) {
      return err(lost);
    }
    const state = new Lease({
      ...this.snapshot,
      revision: this.snapshot.revision + 1,
      holder: null,
      holderId: null,
      renewedAt: now
    });
    const { key, generation } = state.snapshot;
    return ok({ state, events: [{ _tag: "LeaseReleased", key, generation, holderId: holding.holderId }] });
  }

  toSnapshot(): LeaseSnapshot {
    return this.snapshot;
  }

  /** Whether this record is still the given acquisition's: the same holder id and generation. */
  holds(holding: LeaseHolding): boolean {
    const { holderId, generation } = this.snapshot;
    return holderId === holding.holderId && generation === holding.generation;
  }

  /** Why this acquisition no longer holds, or `undefined` when it still does. */
  lossOf(holding: LeaseHolding): LeaseLost | undefined {
    if (this.holds(holding)) {
      return undefined;
    }
    return {
      _tag: "LeaseLost",
      key: this.snapshot.key,
      generation: holding.generation,
      reason: Lease.lossReason(this.snapshot)
    };
  }
  /**
   * A lease can be taken when there is no record, the record is a tombstone, its holder is dead, or it has not been
   * renewed within the TTL as the observer saw it. A live or unknown holder that keeps renewing keeps the lease.
   */
  static canAcquire(lease: Lease | undefined, view: AcquisitionView): boolean {
    return lease === undefined || lease.holder === null || view.liveness === "dead" || !view.fresh;
  }
  /**
   * Why an acquisition that could not renew or write no longer holds, judged from the record it sees: the record is
   * gone (`missing`), a tombstone says it was released, or another holder wrote it (`taken-over`). A tombstone is a
   * record with no holder, so the holder field decides, whatever `holderId` says. How a read that failed counts is
   * the caller's error mapping, not a property of a record.
   */
  static lossReason(record: LeaseSnapshot | undefined): LeaseLost["reason"] {
    if (record === undefined) {
      return "missing";
    }
    return record.holder === null ? "released" : "taken-over";
  }
  /** Restarts the observer's clock when the record has a revision it has not seen. */
  observe(previous: LeaseObservation | undefined, now: number): LeaseObservation {
    return previous?.revision === this.snapshot.revision
      ? previous
      : { revision: this.snapshot.revision, observedAt: now };
  }

  /**
   * Whether a held lease is still valid for this observer: its record changed less than `ttlMs` ago by the observer's
   * monotonic clock. A record whose revision the observation has not seen has just changed, so it is fresh. A
   * tombstone is never fresh.
   */
  isFresh(observation: LeaseObservation, now: number, ttlMs: number): boolean {
    return (
      this.holder !== null && (observation.revision !== this.snapshot.revision || now - observation.observedAt < ttlMs)
    );
  }
}
