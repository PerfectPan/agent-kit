/** A difference three-way verify finds between the disk, the ledger and the desired content. */
export type Drift = "outdated" | "user-modified" | "deleted-externally" | "adoptable";

/**
 * The result of three-way verify for one locator. `ledger-behind`: the disk already holds the desired content but the
 * ledger records something else, so the ledger is updated silently. `missing`: desired, but neither recorded nor on
 * disk. `unmanaged`: on disk, not recorded, and not the desired content.
 */
export type VerifyStatus = "in-sync" | "ledger-behind" | "missing" | "unmanaged" | Drift;
