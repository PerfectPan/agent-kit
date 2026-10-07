import { describe, expect, it } from "vitest";

import type { LifecycleEvent } from "../value-objects/lifecycle-event.js";
import { heartbeatSignal } from "./heartbeat-signal.js";

const event = (fields: Omit<LifecycleEvent, "agent" | "nativeEvent">): LifecycleEvent => ({
  agent: "claude-code",
  nativeEvent: "x",
  ...fields
});

describe("heartbeatSignal", () => {
  it("starts on a turn or subagent start, beats on activity and blocking, and finishes on any end", () => {
    expect(heartbeatSignal(event({ phase: "start", scope: "turn" }))).toBe("start");
    expect(heartbeatSignal(event({ phase: "start", subagent: { id: "a1" } }))).toBe("start");
    expect(heartbeatSignal(event({ phase: "activity" }))).toBe("heartbeat");
    expect(heartbeatSignal(event({ phase: "blocked", blocker: "permission" }))).toBe("heartbeat");
    expect(heartbeatSignal(event({ phase: "finish", scope: "session" }))).toBe("finish");
    expect(heartbeatSignal(event({ phase: "finish", scope: "turn", outcome: "failed" }))).toBe("finish");
  });

  it("says nothing when the agent only opened or the event is unknown", () => {
    expect(heartbeatSignal(event({ phase: "start", scope: "session" }))).toBeUndefined();
    expect(heartbeatSignal(event({ phase: "unknown" }))).toBeUndefined();
  });
});
