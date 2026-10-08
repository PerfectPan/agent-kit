import { err, ok, type Result } from "@rivus/agent-kit/catalog";

import type { LaneQueueFull } from "../errors/lane-queue-full.js";
import type { LaneEvent } from "../events/lane-events.js";
import { admit, type LaneLoad } from "../policies/admission.js";
import type { LaneLimits } from "../value-objects/lane-limits.js";
import type { LaneSnapshot } from "../value-objects/lane-snapshot.js";

export type LaneTransition = { readonly state: Lane; readonly events: readonly LaneEvent[] };

/**
 * One key's lane, held in memory only. At most one activation runs at a time, and every wake that arrives before an
 * activation starts is served by that activation: wakes coalesce instead of queueing one run each. Only an idle lane
 * asks for a slot, so a lane occupies at most one place in the queue.
 */
export class Lane {
  static create(key: string): Lane {
    return new Lane({ key, state: "idle", pending: false });
  }

  private readonly snapshot: LaneSnapshot;

  private constructor(snapshot: LaneSnapshot) {
    this.snapshot = snapshot;
    Object.freeze(this);
  }

  /**
   * An idle lane starts or joins the queue as `admit` decides, and is refused with `LaneQueueFull` when the queue has
   * no room. A queued or running lane takes the wake as pending: it never asks for another slot.
   */
  wake(load: LaneLoad, limits: LaneLimits): Result<LaneTransition, LaneQueueFull> {
    const { key, state } = this.snapshot;
    if (state !== "idle") {
      return ok(this.to({ key, state, pending: true }, { _tag: "WakeCoalesced", key }));
    }
    switch (admit(load, limits)) {
      case "start":
        return ok(this.to({ key, state: "running", pending: false }, { _tag: "ActivationStarted", key }));
      case "queue":
        return ok(this.to({ key, state: "queued", pending: true }, { _tag: "LaneQueued", key }));
      case "full":
        return err({ _tag: "LaneQueueFull", key, maxQueued: limits.maxQueued });
    }
  }

  /** A queued lane got a slot: its activation starts and serves every wake so far. */
  start(): LaneTransition {
    const { key } = this.expect("queued");
    return this.to(
      { key, state: "running", pending: false },
      { _tag: "LaneDequeued", key },
      { _tag: "ActivationStarted", key }
    );
  }

  /**
   * The running activation ended. A wake it did not serve sends the lane to the end of the queue, behind the lanes
   * that waited while it ran; the slot it frees goes to the head of the queue first.
   */
  finish(): LaneTransition {
    const { key, pending } = this.expect("running");
    const ended = { _tag: "ActivationEnded", key } as const;
    return pending
      ? this.to({ key, state: "queued", pending: true }, ended, { _tag: "LaneQueued", key })
      : this.to({ key, state: "idle", pending: false }, ended);
  }

  /**
   * Drops the wakes the lane owes: a queued lane leaves the queue, a running one keeps running without a follow-up.
   * Ending the running activation is the caller's part; wakes after the cancel are owed again.
   */
  cancel(): LaneTransition {
    const { key, state, pending } = this.snapshot;
    if (state === "queued") {
      return this.to({ key, state: "idle", pending: false }, { _tag: "LaneDequeued", key });
    }
    if (state === "running" && pending) {
      return this.to({ key, state, pending: false }, { _tag: "PendingDropped", key });
    }
    return { state: this, events: [] };
  }

  toSnapshot(): LaneSnapshot {
    return this.snapshot;
  }

  private to(snapshot: LaneSnapshot, ...events: LaneEvent[]): LaneTransition {
    return { state: new Lane(snapshot), events };
  }

  /** Starting a lane that is not queued, or finishing one that is not running, is a scheduler bug, not an outcome. */
  private expect(state: LaneSnapshot["state"]): LaneSnapshot {
    if (this.snapshot.state !== state) {
      throw new Error(`lane ${this.snapshot.key} is ${this.snapshot.state}, not ${state}`);
    }
    return this.snapshot;
  }
}
