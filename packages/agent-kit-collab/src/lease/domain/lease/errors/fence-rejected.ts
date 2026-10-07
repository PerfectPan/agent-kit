/** A fenced write carried an older generation than the lease record or the protected resource has seen. */
export interface FenceRejected {
  readonly _tag: "FenceRejected";
  readonly key: string;
  /** The generation of the rejected token. */
  readonly generation: number;
  /** The generation that wins, or `undefined` when the record is missing. */
  readonly current: number | undefined;
}
