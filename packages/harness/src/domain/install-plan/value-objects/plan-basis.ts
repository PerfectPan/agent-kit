/** The ledger a plan was built against, compared before it is applied, like Terraform's lineage and serial. */
export interface PlanBasis {
  readonly ledgerLineage: string;
  readonly ledgerRevision: number;
}

/** Whether the ledger moved on since the plan was built: another lineage, or a newer revision. */
export function basisMoved(
  basedOn: PlanBasis,
  ledger: { readonly lineage: string; readonly revision: number }
): boolean {
  return basedOn.ledgerLineage !== ledger.lineage || basedOn.ledgerRevision !== ledger.revision;
}
