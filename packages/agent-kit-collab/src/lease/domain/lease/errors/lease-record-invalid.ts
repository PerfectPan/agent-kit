/** A stored record breaks the lease invariants, so it is refused rather than overwritten. */
export interface LeaseRecordInvalid {
  readonly _tag: "LeaseRecordInvalid";
  readonly key: string;
  readonly message: string;
}
