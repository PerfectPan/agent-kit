import type { PlanBasis } from "../value-objects/plan-basis.js";

/**
 * The plan can no longer be applied. `ledger-moved`: another apply, uninstall or recovery changed the ledger after
 * the plan was built, so its steps may be wrong. `applied` and `discarded`: the plan was already used up.
 */
export interface PlanStale {
  readonly _tag: "PlanStale";
  readonly planId: string;
  readonly reason: "ledger-moved" | "applied" | "discarded";
  readonly basedOn: PlanBasis;
  readonly current?: PlanBasis;
}
