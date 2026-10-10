/** herdr's names; they map one-to-one to the Claude Agent SDK's `idle`, `running` and `requires_action`. */
export type LifecycleStatus = "idle" | "working" | "blocked" | "unknown";

/**
 * Who raised an open block: the main agent, or a subagent, by id when the agent reports one.
 *
 * A subagent without an id cannot be matched to a later event, so its block is judged on its own clock: it carries
 * the `raisedAt` it was raised at, any id-less raise replaces the entry so the newest unanswered prompt is the one
 * timed, and it expires one TTL after `raisedAt` — the fold drops it and `lifecycleStatus` ignores it, so a session
 * blocked on nothing else continues as `working`. While such a block is open, subagent events do not count as signs
 * of life. An entry without `raisedAt` comes from a state persisted by an older version: it never expires by raise
 * time and heals on the next id-less raise.
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
