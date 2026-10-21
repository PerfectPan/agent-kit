/** The ledger a plan was built against, compared before it is applied, like Terraform's lineage and serial. */
export interface PlanBasisSnapshot {
  readonly ledgerLineage: string;
  readonly ledgerRevision: number;
}

export class PlanBasis {
  readonly #snapshot: PlanBasisSnapshot;
  private constructor(snapshot: PlanBasisSnapshot) {
    this.#snapshot = Object.freeze({ ...snapshot });
    Object.freeze(this);
  }
  static restore(snapshot: PlanBasisSnapshot): PlanBasis {
    return new PlanBasis(snapshot);
  }
  toSnapshot(): PlanBasisSnapshot {
    return this.#snapshot;
  }
  moved(ledger: { readonly lineage: string; readonly revision: number }): boolean {
    return this.#snapshot.ledgerLineage !== ledger.lineage || this.#snapshot.ledgerRevision !== ledger.revision;
  }
}
