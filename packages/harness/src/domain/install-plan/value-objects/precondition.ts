import { err, ok, type Result } from "@rivus/agent-kit-catalog/public";
import { type ContentHash, isContentHash } from "../../ledger/value-objects/content-hash.js";
import type { LedgerEntry } from "../../ledger/entities/ledger-entry.js";
import type { ObservedArtifact } from "../spi/observed-artifact.js";

/**
 * What a step expects at its target when the plan was built, re-checked right before the step writes: nothing there,
 * content with this hash, or (for a step that changes only the ledger) the LedgerEntry still at this
 * `entryRevision`. The re-check narrows the window for a writer outside the LedgerLock; it is not a compare-and-swap.
 */
export type PreconditionSnapshot =
  | { readonly absent: true }
  | { readonly hash: ContentHash }
  | { readonly ownedAt: number };

export class Precondition {
  readonly #snapshot: PreconditionSnapshot;
  private constructor(snapshot: PreconditionSnapshot) {
    this.#snapshot = Object.freeze({ ...snapshot });
    Object.freeze(this);
  }
  static restore(snapshot: PreconditionSnapshot): Result<Precondition, string> {
    const invalid =
      "hash" in snapshot
        ? !isContentHash(snapshot.hash)
        : "ownedAt" in snapshot && !(Number.isSafeInteger(snapshot.ownedAt) && snapshot.ownedAt >= 0);
    return invalid ? err("an invalid precondition") : ok(new Precondition(snapshot));
  }
  toSnapshot(): PreconditionSnapshot {
    return this.#snapshot;
  }
  satisfied(context: { readonly entry?: LedgerEntry; readonly observed?: ObservedArtifact }): boolean {
    const precondition = this.#snapshot;
    if ("ownedAt" in precondition) {
      return context.entry?.entryRevision === precondition.ownedAt;
    }
    return "absent" in precondition ? context.observed === undefined : context.observed?.hash === precondition.hash;
  }
}
