import type { Holder } from "../value-objects/holder.js";

/** Another acquisition holds the lease and is alive and renewing, as far as the observer can tell. */
export interface LeaseHeld {
  readonly _tag: "LeaseHeld";
  readonly key: string;
  readonly generation: number;
  readonly holder: Holder;
  readonly holderId: string;
}
