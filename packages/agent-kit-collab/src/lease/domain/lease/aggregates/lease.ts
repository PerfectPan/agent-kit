import { err, ok, type Result } from "@rivus/agent-kit/catalog";

import type { LeaseHeld } from "../errors/lease-held.js";
import type { LeaseLost } from "../errors/lease-lost.js";
import type { LeaseRecordInvalid } from "../errors/lease-record-invalid.js";
import type { LeaseEvent } from "../events/lease-events.js";
import { type AcquisitionView, canAcquire } from "../policies/acquisition.js";
import { nextFencingToken } from "../policies/fence-check.js";
import { lossReason } from "../policies/loss.js";
import type { Holder } from "../value-objects/holder.js";
import type { LeaseHolding, LeaseSnapshot } from "../value-objects/lease-snapshot.js";

/** One acquisition attempt: who asks, and the wall-clock time recorded for diagnostics. */
export interface LeaseClaim {
  readonly key: string;
  readonly holder: Holder;
  readonly holderId: string;
  readonly now: number;
}

export type LeaseTransition = { readonly state: Lease; readonly events: readonly LeaseEvent[] };

/**
 * One key's lease. It has one holder at a time; its generation never decreases, release included, because release
 * keeps the record as a tombstone; every write increases its revision. Stores persist the snapshot and compare
 * revisions, so a transition only takes effect when no other writer got there first.
 */
export class Lease {
  /** The first acquisition of a key that has no record. */
  static create(claim: LeaseClaim): LeaseTransition {
    const { generation } = nextFencingToken(undefined, claim.key);
    const state = new Lease({
      key: claim.key,
      generation,
      revision: 1,
      holder: claim.holder,
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
    return ok(new Lease({ ...snapshot }));
  }

  private readonly snapshot: LeaseSnapshot;

  // A plain field instead of a parameter property: Node runs this file without a compile step in the cross-process
  // tests, and its type stripping supports only erasable syntax.
  private constructor(snapshot: LeaseSnapshot) {
    this.snapshot = snapshot;
    Object.freeze(this);
  }

  /** Takes the lease when `canAcquire` allows it; the generation moves to the next fencing token. */
  acquire(claim: LeaseClaim, view: AcquisitionView): Result<LeaseTransition, LeaseHeld> {
    const { holder, holderId, generation, key } = this.snapshot;
    if (holder !== null && holderId !== null && !canAcquire(this.snapshot, view)) {
      return err({ _tag: "LeaseHeld", key, generation, holder, holderId });
    }
    const state = new Lease({
      key,
      generation: nextFencingToken(this.snapshot, key).generation,
      revision: this.snapshot.revision + 1,
      holder: claim.holder,
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
      reason: lossReason(this.snapshot)
    };
  }
}

function acquired(snapshot: LeaseSnapshot, previousHolderId: string | null): LeaseEvent {
  const { key, generation, holderId } = snapshot;
  return { _tag: "LeaseAcquired", key, generation, holderId: holderId ?? "", previousHolderId };
}

function invalidity(snapshot: LeaseSnapshot): string | undefined {
  if (snapshot.key === "") {
    return "the key is empty";
  }
  if (!Number.isSafeInteger(snapshot.generation) || snapshot.generation < 1) {
    return `generation ${snapshot.generation} is not a positive integer`;
  }
  if (!Number.isSafeInteger(snapshot.revision) || snapshot.revision < snapshot.generation) {
    return `revision ${snapshot.revision} is not an integer at least as large as the generation`;
  }
  if ((snapshot.holder === null) !== (snapshot.holderId === null)) {
    return "a holder and a holder id come together";
  }
  return Number.isFinite(snapshot.renewedAt) ? undefined : "renewedAt is not a number";
}
