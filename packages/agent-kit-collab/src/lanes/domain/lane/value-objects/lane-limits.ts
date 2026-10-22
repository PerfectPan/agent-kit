import { err, ok, type Result } from "@rivus/agent-kit/catalog";

import type { LanesConfigInvalid } from "../errors/lanes-config-invalid.js";

export interface LaneLimitsInput {
  readonly maxConcurrent: number;
  readonly maxQueued?: number;
  readonly turnTimeoutMs?: number;
}

/** How many activations run and how many lanes wait, across one set of lanes. */
export interface LaneLoad {
  readonly running: number;
  readonly queued: number;
}

export class LaneLimits {
  static create(input: LaneLimitsInput): Result<LaneLimits, LanesConfigInvalid> {
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
    return ok(new LaneLimits(maxConcurrent, maxQueued, turnTimeoutMs));
  }

  /** Activations that may run at once across all lanes. */
  readonly maxConcurrent: number;
  /** Lanes that may wait for a free slot; `Infinity` when unbounded. */
  readonly maxQueued: number;
  /** The longest one activation may run, in milliseconds; `undefined` for no limit. */
  readonly turnTimeoutMs: number | undefined;

  private constructor(maxConcurrent: number, maxQueued: number, turnTimeoutMs: number | undefined) {
    this.maxConcurrent = maxConcurrent;
    this.maxQueued = maxQueued;
    this.turnTimeoutMs = turnTimeoutMs;
    Object.freeze(this);
  }

  /**
   * Where a wake of an idle lane goes: it starts while a slot is free and nobody waits for one, waits at the end of the
   * queue while the queue has room, and is refused otherwise. A newcomer never passes a lane that is already waiting.
   */
  admit(load: LaneLoad): "start" | "queue" | "full" {
    if (load.running < this.maxConcurrent && load.queued === 0) {
      return "start";
    }
    return load.queued < this.maxQueued ? "queue" : "full";
  }

  /**
   * Which queued lane may start now, or `undefined` when none may: the lanes are closed, the queue is empty, or every
   * slot is running. The queue is FIFO: a free slot goes to the lane that has waited longest, and the slot a finishing
   * activation frees goes to the head of the queue first.
   */
  nextToStart(queue: readonly string[], load: LaneLoad, closed: boolean): string | undefined {
    if (closed || load.running >= this.maxConcurrent) {
      return undefined;
    }
    return queue[0];
  }
}
