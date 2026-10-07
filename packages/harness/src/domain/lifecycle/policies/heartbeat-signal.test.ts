import { describe, expect, it } from "vitest";

import type { LifecycleEvent } from "../value-objects/lifecycle-event.js";
import { INITIAL_LIFECYCLE_STATE, type LifecycleState } from "../value-objects/lifecycle-state.js";
import { heartbeatSignal } from "./heartbeat-signal.js";
import { reduceLifecycle } from "./reduce-lifecycle.js";

const clock = { ttlMs: 180_000, now: 1000 };

const event = (fields: Omit<LifecycleEvent, "agent" | "nativeEvent">): LifecycleEvent => ({
  agent: "claude-code",
  nativeEvent: "x",
  ...fields
});

/** Folds the events in order and returns the signal of each. */
function signals(events: readonly LifecycleEvent[], from: LifecycleState = INITIAL_LIFECYCLE_STATE) {
  let state = from;
  return events.map((next) => {
    const after = reduceLifecycle(state, next, clock);
    const signal = heartbeatSignal(state, after, next);
    state = after;
    return signal;
  });
}

describe("heartbeatSignal", () => {
  it("starts on a turn start, beats while busy, and finishes on any end", () => {
    expect(
      signals([
        event({ phase: "start", scope: "turn" }),
        event({ phase: "activity" }),
        event({ phase: "blocked", blocker: "permission" }),
        event({ phase: "finish", scope: "turn", outcome: "failed" }),
        event({ phase: "finish", scope: "session" })
      ])
    ).toEqual(["start", "heartbeat", "heartbeat", "finish", "finish"]);
  });

  it("says nothing when the agent only opened, the event is unknown, or a late tool event follows the finish", () => {
    expect(
      signals([
        event({ phase: "start", scope: "session" }),
        event({ phase: "unknown" }),
        event({ phase: "start", scope: "turn" }),
        event({ phase: "finish" }),
        event({ phase: "activity" })
      ])
    ).toEqual([undefined, undefined, "start", "finish", undefined]);
  });

  it("never starts or finishes the main session on a subagent event, which carries the parent's session id", () => {
    const subagent = { id: "a1", type: "Explore" };
    expect(
      signals([
        event({ phase: "start", scope: "turn", sessionId: "s1" }),
        event({ phase: "start", subagent, sessionId: "s1" }),
        event({ phase: "finish", subagent, sessionId: "s1" }),
        event({ phase: "finish", scope: "turn", sessionId: "s1" }),
        event({ phase: "finish", subagent, sessionId: "s1" })
      ])
    ).toEqual(["start", "heartbeat", "heartbeat", "finish", undefined]);
  });

  it("ignores a late StopCancelled of a turn the next turn already superseded", () => {
    expect(
      signals([
        event({ phase: "start", scope: "turn", turnId: "p1" }),
        event({ phase: "start", scope: "turn", turnId: "p2" }),
        event({ phase: "finish", scope: "turn", outcome: "cancelled", turnId: "p1" }),
        event({ phase: "activity" })
      ])
    ).toEqual(["start", "start", undefined, "heartbeat"]);
  });
});
