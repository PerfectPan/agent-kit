/**
 * Proof of holding a lease, passed with every fenced write. A resource that can compare atomically keeps the highest
 * generation it has seen for the key and refuses a smaller one (`checkFence`).
 */
export interface FencingToken {
  readonly key: string;
  readonly generation: number;
}
