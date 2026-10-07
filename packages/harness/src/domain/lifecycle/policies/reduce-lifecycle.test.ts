import { describe, expect, it } from "vitest";

import type { LifecycleEvent } from "../value-objects/lifecycle-event.js";
import { INITIAL_LIFECYCLE_STATE, type LifecycleState } from "../value-objects/lifecycle-state.js";
import { lifecycleStatus, reduceLifecycle } from "./reduce-lifecycle.js";

const TTL = 180_000;

type Step = Omit<LifecycleEvent, "agent" | "nativeEvent"> & { readonly at?: number };

/** Folds the steps one second apart (or at their own `at`) and returns the final state. */
function fold(steps: readonly Step[], from: LifecycleState = INITIAL_LIFECYCLE_STATE): LifecycleState {
  return steps.reduce<LifecycleState>(
    (state, { at, ...step }, index) =>
      reduceLifecycle(state, { agent: "codex", nativeEvent: "x", ...step }, { ttlMs: TTL, now: at ?? index * 1000 }),
    from
  );
}

const status = (steps: readonly Step[]) => fold(steps).status;

describe("reduceLifecycle", () => {
  it("follows a turn through working, blocked and idle", () => {
    expect(status([{ phase: "start", scope: "session" }])).toBe("idle");
    expect(status([{ phase: "start", scope: "turn" }])).toBe("working");
    expect(
      status([
        { phase: "start", scope: "turn" },
        { phase: "blocked", blocker: "permission" }
      ])
    ).toBe("blocked");
    expect(
      status([{ phase: "start", scope: "turn" }, { phase: "blocked", blocker: "permission" }, { phase: "activity" }])
    ).toBe("working");
    expect(
      status([
        { phase: "start", scope: "turn" },
        { phase: "finish", scope: "turn" }
      ])
    ).toBe("idle");
  });

  it("lets a session start settle only an unknown or idle session, without taking its turn id as a turn", () => {
    expect(
      fold([
        { phase: "start", scope: "session", turnId: "gen-1" },
        { phase: "start", scope: "turn", turnId: "gen-1" }
      ])
    ).toMatchObject({ status: "working", turnId: "gen-1", endedTurns: [] });
    expect(
      fold([
        { phase: "start", scope: "turn", turnId: "gen-1" },
        { phase: "start", scope: "session", turnId: "gen-1" },
        { phase: "activity", turnId: "gen-1" }
      ])
    ).toMatchObject({ status: "working", turnId: "gen-1", endedTurns: [] });
    expect(
      status([
        { phase: "start", scope: "turn" },
        { phase: "start", scope: "session" }
      ])
    ).toBe("working");
    expect(status([{ phase: "finish" }, { phase: "start", scope: "session" }])).toBe("idle");
  });

  it("surfaces a subagent's permission prompt as blocked until the subagent moves again", () => {
    const subagent = { id: "agent-7" };
    expect(
      status([
        { phase: "start", scope: "turn", turnId: "t1" },
        { phase: "blocked", blocker: "permission", turnId: "t1", subagent }
      ])
    ).toBe("blocked");
    expect(
      status([
        { phase: "start", scope: "turn", turnId: "t1" },
        { phase: "blocked", blocker: "permission", turnId: "t1", subagent },
        { phase: "activity", turnId: "t1", subagent }
      ])
    ).toBe("working");
    expect(
      status([
        { phase: "start", scope: "turn" },
        { phase: "blocked", blocker: "question", subagent }
      ])
    ).toBe("working");
    expect(status([{ phase: "finish" }, { phase: "blocked", blocker: "permission", subagent }])).toBe("idle");
  });

  it("S31: ignores a late event of an older turn", () => {
    const state = fold([
      { phase: "start", scope: "turn", turnId: "t1" },
      { phase: "activity", turnId: "t1" },
      { phase: "start", scope: "turn", turnId: "t2" },
      { phase: "finish", scope: "turn", turnId: "t2" },
      { phase: "activity", turnId: "t1" }
    ]);
    expect(state.status).toBe("idle");
    expect(state.endedTurns).toEqual(["t1", "t2"]);
  });

  it("drops a late finish of a superseded turn while the new turn works", () => {
    expect(
      status([
        { phase: "start", scope: "turn", turnId: "t1" },
        { phase: "start", scope: "turn", turnId: "t2" },
        { phase: "finish", scope: "turn", turnId: "t1" }
      ])
    ).toBe("working");
  });

  it("treats an unseen turn id as a new turn whose start was lost", () => {
    expect(
      status([
        { phase: "finish", scope: "turn", turnId: "t1" },
        { phase: "activity", turnId: "t2" }
      ])
    ).toBe("working");
  });

  it("does not let activity without a turn id reopen a finished turn", () => {
    expect(status([{ phase: "start", scope: "turn" }, { phase: "finish" }, { phase: "activity" }])).toBe("idle");
    expect(status([{ phase: "start", scope: "turn" }, { phase: "finish" }, { phase: "blocked" }])).toBe("idle");
    expect(status([{ phase: "start", scope: "turn" }, { phase: "finish" }, { phase: "start", scope: "turn" }])).toBe(
      "working"
    );
  });

  it("starts working on activity when the session's start was never seen", () => {
    expect(status([{ phase: "activity" }])).toBe("working");
  });

  it("S47: keeps the main session's status on subagent events, and keeps a busy session alive", () => {
    const working = fold([{ phase: "start", scope: "turn", at: 0 }]);
    const later = reduceLifecycle(
      working,
      { agent: "claude-code", nativeEvent: "SubagentStop", phase: "finish", subagent: { id: "a1" } },
      { ttlMs: TTL, now: 100_000 }
    );
    expect(later.status).toBe("working");
    expect(lifecycleStatus(later, { ttlMs: TTL, now: 250_000 })).toBe("working");
    expect(lifecycleStatus(working, { ttlMs: TTL, now: 250_000 })).toBe("unknown");

    const idle = fold([{ phase: "start", scope: "session" }]);
    expect(
      reduceLifecycle(
        idle,
        { agent: "claude-code", nativeEvent: "SubagentStart", phase: "start", subagent: {} },
        { ttlMs: TTL, now: 5000 }
      )
    ).toEqual(idle);
  });

  it("falls back to unknown after the TTL and recovers on the next event", () => {
    const working = fold([{ phase: "start", scope: "turn", at: 0 }]);
    expect(lifecycleStatus(working, { ttlMs: TTL, now: TTL })).toBe("working");
    expect(lifecycleStatus(working, { ttlMs: TTL, now: TTL + 1 })).toBe("unknown");
    expect(fold([{ phase: "activity", at: TTL + 1 }], working).status).toBe("working");

    const blocked = fold([{ phase: "blocked", at: 0 }]);
    expect(lifecycleStatus(blocked, { ttlMs: TTL, now: TTL + 1 })).toBe("unknown");

    const idle = fold([{ phase: "finish", at: 0 }]);
    expect(lifecycleStatus(idle, { ttlMs: TTL, now: 10 * TTL })).toBe("idle");
  });

  it("ignores unknown events and does not change the given state", () => {
    const working = fold([{ phase: "start", scope: "turn" }]);
    const frozen = { ...working, endedTurns: [...working.endedTurns] };
    expect(fold([{ phase: "unknown" }], working)).toEqual(working);
    reduceLifecycle(working, { agent: "codex", nativeEvent: "Stop", phase: "finish" }, { ttlMs: TTL, now: 1 });
    expect(working).toEqual(frozen);
  });

  it("keeps a bounded list of ended turns", () => {
    const steps = Array.from({ length: 40 }, (_, index): Step => ({ phase: "finish", turnId: `t${index}` }));
    const state = fold(steps);
    expect(state.endedTurns).toHaveLength(16);
    expect(state.endedTurns.at(-1)).toBe("t39");
  });
});
