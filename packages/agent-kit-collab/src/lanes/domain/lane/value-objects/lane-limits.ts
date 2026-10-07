import { err, ok, type Result } from "@rivus/agent-kit/catalog";

import type { LanesConfigInvalid } from "../errors/lanes-config-invalid.js";

/** Capacity, QueueBound and TurnTimeout of one set of lanes. */
export interface LaneLimits {
  /** Activations that may run at once across all lanes. */
  readonly maxConcurrent: number;
  /** Lanes that may wait for a free slot; `Infinity` when unbounded. */
  readonly maxQueued: number;
  /** The longest one activation may run, in milliseconds; `undefined` for no limit. */
  readonly turnTimeoutMs: number | undefined;
}

export interface LaneLimitsInput {
  readonly maxConcurrent: number;
  readonly maxQueued?: number;
  readonly turnTimeoutMs?: number;
}

export function laneLimits(input: LaneLimitsInput): Result<LaneLimits, LanesConfigInvalid> {
  const { maxConcurrent, maxQueued = Number.POSITIVE_INFINITY, turnTimeoutMs } = input;
  const invalid = (message: string) => err<LanesConfigInvalid>({ _tag: "LanesConfigInvalid", message });
  if (!Number.isSafeInteger(maxConcurrent) || maxConcurrent < 1) {
    return invalid(`maxConcurrent must be a positive integer, got ${maxConcurrent}`);
  }
  if (maxQueued !== Number.POSITIVE_INFINITY && (!Number.isSafeInteger(maxQueued) || maxQueued < 0)) {
    return invalid(`maxQueued must be a non-negative integer, got ${maxQueued}`);
  }
  if (turnTimeoutMs !== undefined && (!Number.isFinite(turnTimeoutMs) || turnTimeoutMs <= 0)) {
    return invalid(`turnTimeoutMs must be a positive number of milliseconds, got ${turnTimeoutMs}`);
  }
  return ok({ maxConcurrent, maxQueued, turnTimeoutMs });
}
