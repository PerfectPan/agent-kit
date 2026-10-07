import type { Holder } from "./holder.js";

/** A lease record as stores keep it. A released lease stays as a tombstone with no holder. */
export interface LeaseSnapshot {
  readonly key: string;
  /** The fencing token: +1 on every acquisition, unchanged by renewals and release. */
  readonly generation: number;
  /** +1 on every write; stores compare it to write only over the record a caller read. */
  readonly revision: number;
  readonly holder: Holder | null;
  /** Names one acquisition, so that two acquisitions by the same process are told apart. */
  readonly holderId: string | null;
  /** Wall-clock time of the last write, for diagnostics; expiry is judged with the observer's monotonic clock. */
  readonly renewedAt: number;
}

/** What one acquisition knows about itself: renewing and releasing need both to match the record. */
export interface LeaseHolding {
  readonly holderId: string;
  readonly generation: number;
}
