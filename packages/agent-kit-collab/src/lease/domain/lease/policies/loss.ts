import type { LeaseLost } from "../errors/lease-lost.js";
import type { LeaseSnapshot } from "../value-objects/lease-snapshot.js";

/**
 * Why an acquisition that could not renew or write no longer holds, judged from the record it sees: the record is
 * gone (`missing`), a tombstone says it was released, or another holder wrote it (`taken-over`). How a read that
 * failed counts is the caller's error mapping, not a property of a record.
 */
export function lossReason(record: LeaseSnapshot | undefined): LeaseLost["reason"] {
  if (record === undefined) {
    return "missing";
  }
  return record.holderId === null ? "released" : "taken-over";
}
