import type { PendingOperation } from "../value-objects/pending-operation.js";

/** An earlier modification did not finish. Probe its targets and `recover` before planning or modifying again. */
export interface PendingOperations {
  readonly _tag: "PendingOperations";
  readonly operations: readonly PendingOperation[];
}
