import type { ContentHash } from "../../ledger/value-objects/content-hash.js";

/**
 * What a step expects at its target when the plan was built, re-checked right before the step writes: nothing there,
 * content with this hash, or (for a step that changes only the ledger) the LedgerEntry still at this
 * `entryRevision`. The re-check narrows the window for a writer outside the LedgerLock; it is not a compare-and-swap.
 */
export type Precondition = { readonly absent: true } | { readonly hash: ContentHash } | { readonly ownedAt: number };
