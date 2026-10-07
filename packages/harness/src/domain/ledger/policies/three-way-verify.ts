import type { ContentHash } from "../value-objects/content-hash.js";
import type { VerifyStatus } from "../value-objects/drift.js";

export interface VerifyInput {
  /** The LedgerEntry's contentHash; absent when the ledger has no entry. */
  readonly ledger?: ContentHash;
  /** What is on disk; absent when nothing is there. */
  readonly actual?: ContentHash;
  /** What the bundle wants; absent when it wants nothing there, or when the caller does not know. */
  readonly desired?: ContentHash;
}

/**
 * Compares the disk with both the ledger and the desired content, the way chezmoi does, so that a change made after
 * harness wrote is told apart from a change harness has yet to make:
 *
 * | ledger | disk | desired | status |
 * | --- | --- | --- | --- |
 * | L | = L | = L or unknown | in-sync |
 * | L | = L | ≠ L | outdated |
 * | L | ≠ L | = disk | ledger-behind (update the ledger silently) |
 * | L | ≠ L | ≠ disk or unknown | user-modified |
 * | L | none | any | deleted-externally |
 * | none | X | = X | adoptable |
 * | none | X | ≠ X or none | unmanaged |
 * | none | none | D | missing |
 * | none | none | none | in-sync |
 */
export function threeWayVerify({ ledger, actual, desired }: VerifyInput): VerifyStatus {
  if (ledger === undefined) {
    if (actual === undefined) {
      return desired === undefined ? "in-sync" : "missing";
    }
    return actual === desired ? "adoptable" : "unmanaged";
  }
  if (actual === undefined) {
    return "deleted-externally";
  }
  if (actual === ledger) {
    return desired === undefined || desired === ledger ? "in-sync" : "outdated";
  }
  return actual === desired ? "ledger-behind" : "user-modified";
}
