import type { HolderLiveness } from "../value-objects/holder.js";
import type { LeaseSnapshot } from "../value-objects/lease-snapshot.js";

/** What the observer found out about the current holder before trying to acquire. */
export interface AcquisitionView {
  /** `isFresh` for the record as read. */
  readonly fresh: boolean;
  /** `holderLiveness` for its holder; irrelevant for a tombstone. */
  readonly liveness: HolderLiveness;
}

/**
 * A lease can be taken when there is no record, the record is a tombstone, its holder is dead, or it has not been
 * renewed within the TTL as the observer saw it. A live or unknown holder that keeps renewing keeps the lease.
 */
export function canAcquire(lease: LeaseSnapshot | undefined, view: AcquisitionView): boolean {
  return lease === undefined || lease.holder === null || view.liveness === "dead" || !view.fresh;
}
