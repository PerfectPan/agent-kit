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
