import type { LifecycleEvent } from "../value-objects/lifecycle-event.js";
import type { LifecycleState } from "../value-objects/lifecycle-state.js";

export type HeartbeatSignal = "start" | "heartbeat" | "finish";

const busy = (state: LifecycleState): boolean => state.status === "working" || state.status === "blocked";

/**
 * How a tracker that keeps the main session alive by heartbeat, such as agent-presence, reads one event. Pass the
 * session's state before and after `reduceLifecycle` folded the event, so the reducer's rules decide: a late event of
 * an ended or superseded turn says nothing, and a subagent event (whose payload can carry the parent's session id)
 * never starts or finishes the main session, it only keeps a busy one alive.
 *
 * Otherwise a turn start starts, activity and blocking keep alive while the session is busy, and any end finishes.
 * An agent that only opened is not working yet. "Done but not yet viewed" is a view over `finish`, not a signal.
 */
export function heartbeatSignal(
  before: LifecycleState,
  after: LifecycleState,
  event: LifecycleEvent
): HeartbeatSignal | undefined {
  if (event.phase === "unknown" || (event.turnId !== undefined && before.endedTurns.includes(event.turnId))) {
    return undefined;
  }
  if (event.subagent !== undefined) {
    return busy(after) ? "heartbeat" : undefined;
  }
  switch (event.phase) {
    case "start":
      return event.scope === "session" ? undefined : "start";
    case "activity":
    case "blocked":
      return busy(after) ? "heartbeat" : undefined;
    case "finish":
      return "finish";
  }
}
