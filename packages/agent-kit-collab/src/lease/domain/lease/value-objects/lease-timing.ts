import { err, ok, type Result } from "@rivus/agent-kit/catalog";

import type { LeaseConfigInvalid } from "../errors/lease-config-invalid.js";

/** How often a lease is renewed and how long it outlives a renewal, as the manager's clocks measure it. */
export interface LeaseTiming {
  /** How long a lease stays valid without a renewal, per observer's monotonic clock. */
  readonly ttlMs: number;
  /** How often the holder renews; two must fit in the TTL. */
  readonly heartbeatMs: number;
  /** How often a waiting acquire retries; `heartbeatMs` by default. */
  readonly retryMs: number;
}

export interface LeaseTimingInput {
  readonly ttlMs: number;
  readonly heartbeatMs: number;
  /** Absent or `null` falls back to `heartbeatMs`. */
  readonly retryMs?: number;
}

/** Accepts a timing where every duration is positive and one late heartbeat cannot lose the lease. */
export function leaseTiming(input: LeaseTimingInput): Result<LeaseTiming, LeaseConfigInvalid> {
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
  return ok({ ttlMs, heartbeatMs, retryMs });
}
