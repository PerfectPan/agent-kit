/** The wake joined an activation that has not started yet: the queued one, or the one after the running one. */
export interface WakeCoalesced {
  readonly _tag: "WakeCoalesced";
  readonly key: string;
}

/** The lane joined the end of the queue to wait for a free slot. */
export interface LaneQueued {
  readonly _tag: "LaneQueued";
  readonly key: string;
}

/** The lane left the queue, because it got a slot or was cancelled. */
export interface LaneDequeued {
  readonly _tag: "LaneDequeued";
  readonly key: string;
}

export interface ActivationStarted {
  readonly _tag: "ActivationStarted";
  readonly key: string;
}

export interface ActivationEnded {
  readonly _tag: "ActivationEnded";
  readonly key: string;
}

/** A cancel dropped the wake a running lane owed, so no activation follows the running one. */
export interface PendingDropped {
  readonly _tag: "PendingDropped";
  readonly key: string;
}

export type LaneEvent =
  | WakeCoalesced
  | LaneQueued
  | LaneDequeued
  | ActivationStarted
  | ActivationEnded
  | PendingDropped;
