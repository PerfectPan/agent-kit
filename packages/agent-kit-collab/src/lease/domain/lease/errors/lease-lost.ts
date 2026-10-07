/**
 * This acquisition no longer holds the lease: another one took it over or released it, the record vanished, or no
 * renewal could be confirmed within the TTL.
 */
export interface LeaseLost {
  readonly _tag: "LeaseLost";
  readonly key: string;
  readonly generation: number;
  readonly reason: "taken-over" | "released" | "missing" | "expired";
}
