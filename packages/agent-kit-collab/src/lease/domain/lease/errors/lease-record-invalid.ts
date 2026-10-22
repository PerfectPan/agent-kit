/** A stored or proposed record breaks the lease invariants, so the stored record is left unchanged. */
export interface LeaseRecordInvalid {
  readonly _tag: "LeaseRecordInvalid";
  readonly key: string;
  readonly message: string;
}
