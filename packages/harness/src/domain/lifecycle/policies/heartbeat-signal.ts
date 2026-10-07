import type { LifecycleEvent } from "../value-objects/lifecycle-event.js";

export type HeartbeatSignal = "start" | "heartbeat" | "finish";

/**
 * How a tracker that keeps sessions alive by heartbeat, such as agent-presence, reads an event: a turn starting (or
 * a subagent starting) starts, activity and blocking keep alive, any end finishes. An agent that only opened is not
 * working yet, and an unknown event says nothing. "Done but not yet viewed" is a view over `finish`, not a signal.
 */
export function heartbeatSignal(event: LifecycleEvent): HeartbeatSignal | undefined {
  switch (event.phase) {
    case "start":
      return event.scope === "session" && event.subagent === undefined ? undefined : "start";
    case "activity":
    case "blocked":
      return "heartbeat";
    case "finish":
      return "finish";
    case "unknown":
      return undefined;
  }
}
