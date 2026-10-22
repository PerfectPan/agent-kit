import { err, ok, type Result } from "@rivus/agent-kit/catalog";

import type { LeaseRecordInvalid } from "../errors/lease-record-invalid.js";
import type { FenceRejected } from "../errors/fence-rejected.js";

/**
 * Proof of holding a lease, passed with every fenced write. The protected resource should atomically keep the highest
 * generation it has accepted for each key and reject smaller generations; an equal generation is the same holder.
 */
export interface FencingTokenSnapshot {
  readonly key: string;
  readonly generation: number;
}

export class FencingToken {
  private static problem({ key, generation }: FencingTokenSnapshot): string | undefined {
    if (key === "") {
      return "the key is empty";
    }
    return !Number.isSafeInteger(generation) || generation < 1
      ? `generation ${generation} is not a positive integer`
      : undefined;
  }

  static create(snapshot: FencingTokenSnapshot): Result<FencingToken, LeaseRecordInvalid> {
    const problem = FencingToken.problem(snapshot);
    return problem === undefined
      ? ok(new FencingToken(snapshot))
      : err({ _tag: "LeaseRecordInvalid", key: snapshot.key, message: problem });
  }

  /** One generation above the record, or 1 for a new key; exhaustion leaves the record unchanged. */
  static next(key: string, current?: FencingToken): Result<FencingToken, LeaseRecordInvalid> {
    return FencingToken.create({ key, generation: (current?.generation ?? 0) + 1 });
  }

  readonly key: string;
  readonly generation: number;

  private constructor(snapshot: FencingTokenSnapshot) {
    this.key = snapshot.key;
    this.generation = snapshot.generation;
    Object.freeze(this);
  }

  /**
   * Checks inside the protected resource's atomic write. A smaller generation for the same key is refused; an equal
   * one is the same holder writing again. On success, store the returned token as the new highest token.
   */
  checkFence(lastSeen: FencingToken | undefined): Result<FencingToken, FenceRejected> {
    if (lastSeen !== undefined && lastSeen.key === this.key && this.generation < lastSeen.generation) {
      return err({ _tag: "FenceRejected", key: this.key, generation: this.generation, current: lastSeen.generation });
    }
    return ok(this);
  }

  toSnapshot(): FencingTokenSnapshot {
    return { key: this.key, generation: this.generation };
  }
}
