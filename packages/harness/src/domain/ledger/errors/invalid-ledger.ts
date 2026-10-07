import type { LocatorKey } from "../../install-plan/value-objects/artifact-locator.js";

/** A ledger of a known version that breaks its invariants, such as an entry without owners. It is refused, never cleared. */
export interface InvalidLedger {
  readonly _tag: "InvalidLedger";
  readonly reason: string;
  readonly key?: LocatorKey;
}
