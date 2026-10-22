import { err, ok, type Result } from "@rivus/agent-kit/catalog";

import type { LeaseConfigInvalid } from "../errors/lease-config-invalid.js";

export interface LeaseTimingInput {
  readonly ttlMs: number;
  readonly heartbeatMs: number;
  /** Absent or `null` falls back to `heartbeatMs`. */
  readonly retryMs?: number;
}

export class LeaseTiming {
  static create(input: LeaseTimingInput): Result<LeaseTiming, LeaseConfigInvalid> {
    const { ttlMs, heartbeatMs } = input;
    const retryMs = input.retryMs ?? heartbeatMs;
    const invalid = (message: string) => err<LeaseConfigInvalid>({ _tag: "LeaseConfigInvalid", message });
    for (const [name, value] of [
      ["ttlMs", ttlMs],
      ["heartbeatMs", heartbeatMs],
      ["retryMs", retryMs]
    ] as const) {
      if (!Number.isFinite(value) || value <= 0) {
        return invalid(`${name} must be a positive number of milliseconds, got ${value}`);
      }
    }
    if (heartbeatMs * 2 > ttlMs) {
      return invalid(`heartbeatMs × 2 must not exceed ttlMs (${heartbeatMs} × 2 > ${ttlMs})`);
    }
    return ok(new LeaseTiming(ttlMs, heartbeatMs, retryMs));
  }

  /** How long a lease stays valid without a renewal, per observer's monotonic clock. */
  readonly ttlMs: number;
  /** How often the holder renews; two must fit in the TTL. */
  readonly heartbeatMs: number;
  /** How often a waiting acquire retries; `heartbeatMs` by default. */
  readonly retryMs: number;

  private constructor(ttlMs: number, heartbeatMs: number, retryMs: number) {
    this.ttlMs = ttlMs;
    this.heartbeatMs = heartbeatMs;
    this.retryMs = retryMs;
    Object.freeze(this);
  }

  /**
   * Whether the holder itself must give up: it has not confirmed a renewal for a full TTL, so an observer's clock may
   * already have expired the lease and a takeover can have happened. Both times come from the holder's own monotonic
   * clock; `confirmedAt` is when its last renewal write was accepted.
   */
  holderExpired(confirmedAt: number, now: number): boolean {
    return now - confirmedAt >= this.ttlMs;
  }
}
