/** herdr's names; they map one-to-one to the Claude Agent SDK's `idle`, `running` and `requires_action`. */
export type LifecycleStatus = "idle" | "working" | "blocked" | "unknown";

/**
 * Who raised an open block: the main agent, or a subagent, by id when the agent reports one. An id-less subagent
 * block cannot be matched to a later event, so it carries the `raisedAt` it was raised at and expires one TTL after
 * that; `reduceLifecycle` owns the rule.
 */
export type BlockSource =
  | { readonly kind: "main" }
  | { readonly kind: "subagent"; readonly id?: string; readonly raisedAt?: number };

/** What `reduceLifecycle` remembers about one session between hook events. */
export interface LifecycleState {
  readonly status: LifecycleStatus;
  /** While `blocked`: every source whose prompt is still open. */
  readonly blockedBy?: readonly BlockSource[];
  /** The turn in progress, when the agent reports turn ids. */
  readonly turnId?: string;
  /** Recent turns that ended or were superseded, oldest first; an event naming one of them arrived late. */
  readonly endedTurns: readonly string[];
  /** When the last accepted event arrived, on the caller's clock in milliseconds. An id-less block's expiry rides
   * on its own `raisedAt`, not on this. */
  readonly updatedAt?: number;
}

export interface LifecycleClock {
  /** How long `working` or `blocked` lasts without an event before the status falls back to `unknown`. */
  readonly ttlMs: number;
  readonly now: number;
}

/** The state before any event of a session. */
export const INITIAL_LIFECYCLE_STATE: LifecycleState = { status: "unknown", endedTurns: [] };
