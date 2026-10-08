import type { LeaseSnapshot } from "../value-objects/lease-snapshot.js";

/**
 * When an observer last saw a lease record change. Monotonic clocks of two processes cannot be compared, so each
 * observer times a revision from the moment it first read it, as client-go's leader election does.
 */
export interface LeaseObservation {
  readonly revision: number;
  /** The observer's monotonic time when it first read `revision`. */
  readonly observedAt: number;
}

/** Restarts the observer's clock when the record has a revision it has not seen. */
export function observe(previous: LeaseObservation | undefined, lease: LeaseSnapshot, now: number): LeaseObservation {
  return previous?.revision === lease.revision ? previous : { revision: lease.revision, observedAt: now };
}

/**
 * Whether a held lease is still valid for this observer: its record changed less than `ttlMs` ago by the observer's
 * monotonic clock. A record whose revision the observation has not seen has just changed, so it is fresh. A
 * tombstone is never fresh.
 */
export function isFresh(lease: LeaseSnapshot, observation: LeaseObservation, now: number, ttlMs: number): boolean {
  return lease.holder !== null && (observation.revision !== lease.revision || now - observation.observedAt < ttlMs);
}

/**
 * Whether the holder itself must give up: it has not confirmed a renewal for a full TTL, so an observer's clock may
 * already have expired the lease and a takeover can have happened. Both times come from the holder's own monotonic
 * clock; `confirmedAt` is when its last renewal write was accepted.
 */
export function holderExpired(confirmedAt: number, now: number, ttlMs: number): boolean {
  return now - confirmedAt >= ttlMs;
}
