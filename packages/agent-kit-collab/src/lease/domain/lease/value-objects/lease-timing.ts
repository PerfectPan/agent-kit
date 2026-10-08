import { err, ok, type Result } from "@rivus/agent-kit/catalog";

import type { LeaseConfigInvalid } from "../errors/lease-config-invalid.js";

/** How often a lease is renewed and how long it outlives a renewal, as the manager's clocks measure it. */
export interface LeaseTiming {
  /** How long a lease stays valid without a renewal, as each observer's monotonic clock measures it. */
  readonly ttlMs: number;
  /** How often the holder renews. Two heartbeats must fit in the TTL, so one late heartbeat does not lose it. */
  readonly heartbeatMs: number;
  /** How often `acquire({ wait: true })` tries again; `heartbeatMs` by default. */
  readonly retryMs: number;
}

export interface LeaseTimingInput {
  readonly ttlMs: number;
  readonly heartbeatMs: number;
  readonly retryMs?: number;
}

/** Accepts a timing where every duration is positive and one late heartbeat cannot lose the lease. */
export function leaseTiming(input: LeaseTimingInput): Result<LeaseTiming, LeaseConfigInvalid> {
  const { ttlMs, heartbeatMs, retryMs = heartbeatMs } = input;
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
  return ok({ ttlMs, heartbeatMs, retryMs });
}
