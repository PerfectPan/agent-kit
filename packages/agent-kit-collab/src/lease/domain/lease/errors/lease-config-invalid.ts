/** A lease duration is out of range, or the heartbeat does not fit twice into the TTL. */
export interface LeaseConfigInvalid {
  readonly _tag: "LeaseConfigInvalid";
  readonly message: string;
}
