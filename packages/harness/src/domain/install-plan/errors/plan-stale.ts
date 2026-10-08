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

/** The error for applying or discarding a plan that was used up. */
export function planClosedError(plan: {
  readonly planId: string;
  readonly status: "ready" | "applied" | "discarded";
  readonly basedOn: PlanBasis;
}): PlanStale | undefined {
  return plan.status === "ready"
    ? undefined
    : { _tag: "PlanStale", planId: plan.planId, reason: plan.status, basedOn: plan.basedOn };
}

/** The error for a plan whose basis the ledger moved on, when the ledger is not exactly what it was built on. */
export function ledgerMovedError(
  planId: string,
  basedOn: PlanBasis,
  ledger: { readonly lineage: string; readonly revision: number }
): PlanStale {
  return {
    _tag: "PlanStale",
    planId,
    reason: "ledger-moved",
    basedOn,
    current: { ledgerLineage: ledger.lineage, ledgerRevision: ledger.revision }
  };
}
