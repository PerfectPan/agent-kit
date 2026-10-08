import type { LaneEvent } from "../events/lane-events.js";
import type { LaneLimits } from "../value-objects/lane-limits.js";

/** How many activations run and how many lanes wait, across one set of lanes. */
export interface LaneLoad {
  readonly running: number;
  readonly queued: number;
}

/**
 * Where a wake of an idle lane goes: it starts while a slot is free and nobody waits for one, waits at the end of the
 * queue while the queue has room, and is refused otherwise. A newcomer never passes a lane that is already waiting.
 */
export function admit(load: LaneLoad, limits: LaneLimits): "start" | "queue" | "full" {
  if (load.running < limits.maxConcurrent && load.queued === 0) {
    return "start";
  }
  return load.queued < limits.maxQueued ? "queue" : "full";
}

/**
 * Which queued lane may start now, or `undefined` when none may: the lanes are closed, the queue is empty, or every
 * slot is running. The queue is FIFO: a free slot goes to the lane that has waited longest, and the slot a finishing
 * activation frees goes to the head of the queue first.
 */
export function nextToStart(
  queue: readonly string[],
  load: LaneLoad,
  limits: LaneLimits,
  closed: boolean
): string | undefined {
  if (closed || load.running >= limits.maxConcurrent) {
    return undefined;
  }
  return queue[0];
}

/**
 * `started`: an activation started; `queued`: the lane waits for a free slot; `coalesced`: an activation that has not
 * started yet serves this wake (the queued one, or the one that follows the running one).
 */
export type WakeResult = "started" | "queued" | "coalesced";

/** Reads how a wake ended from the events its transition produced. */
export function wakeResult(events: readonly LaneEvent[]): WakeResult {
  return events.some(({ _tag }) => _tag === "ActivationStarted")
    ? "started"
    : events.some(({ _tag }) => _tag === "LaneQueued")
      ? "queued"
      : "coalesced";
}
