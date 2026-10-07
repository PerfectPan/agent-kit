/** The ledger a plan was built against, compared before it is applied, like Terraform's lineage and serial. */
export interface PlanBasis {
  readonly ledgerLineage: string;
  readonly ledgerRevision: number;
}
