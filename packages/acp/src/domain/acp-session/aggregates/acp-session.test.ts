import { describe, expect, it } from "vite-plus/test";

import { AcpSession, type AcpSessionTransition } from "./acp-session.js";

function value<T>(
  result: { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: unknown }
): T {
  if (!result.ok) {
    throw new Error(`refused: ${JSON.stringify(result.error)}`);
  }
  return result.value;
}

const ready = (sessionKey?: string): AcpSession =>
  value(value(AcpSession.create({ agent: "codex", ...(sessionKey ? { sessionKey } : {}) })).opened("s1")).state;

const tags = (transition: AcpSessionTransition) => transition.events.map((event) => event._tag);

describe("AcpSession", () => {
  it("starts, opens and runs one turn at a time", () => {
    const starting = value(AcpSession.create({ agent: "codex" }));
    expect(starting.toSnapshot()).toEqual({
      agent: "codex",
      state: "starting",
      turns: 0,
      pendingPermissions: 0
    });
    expect(starting.startTurn()).toEqual({
      ok: false,
      error: { _tag: "IllegalTransition", transition: "startTurn", state: "starting" }
    });
    const opened = value(starting.opened("s1"));
    expect(tags(opened)).toEqual(["SessionOpened"]);
    const started = value(opened.state.startTurn());
    expect(started.events).toEqual([{ _tag: "TurnStarted", sessionId: "s1", turn: 1 }]);
    expect(started.state.startTurn()).toEqual({
      ok: false,
      error: { _tag: "TurnInProgress", sessionId: "s1", turn: 1 }
    });
    const finished = value(started.state.finishTurn("end_turn"));
    expect(finished.events).toEqual([{ _tag: "TurnFinished", sessionId: "s1", turn: 1, finishReason: "end_turn" }]);
    expect(value(finished.state.startTurn()).state.toSnapshot()).toMatchObject({
      state: "turn",
      turns: 2
    });
  });

  it("leaves the previous state unchanged and freezes every state", () => {
    const session = ready();
    const next = value(session.startTurn()).state;
    expect(session.toSnapshot().state).toBe("ready");
    expect(next.toSnapshot().state).toBe("turn");
    expect(Object.isFrozen(next)).toBe(true);
  });

  it("counts permission requests and returns to the turn when all are answered", () => {
    const turn = value(ready().startTurn()).state;
    const asked = value(value(turn.requestPermission()).state.requestPermission()).state;
    expect(asked.toSnapshot()).toMatchObject({
      state: "awaiting-permission",
      pendingPermissions: 2
    });
    const once = value(asked.answerPermission()).state;
    expect(once.toSnapshot()).toMatchObject({
      state: "awaiting-permission",
      pendingPermissions: 1
    });
    expect(value(once.answerPermission()).state.toSnapshot()).toMatchObject({
      state: "turn",
      pendingPermissions: 0
    });
    expect(ready().requestPermission()).toMatchObject({
      ok: false,
      error: { _tag: "IllegalTransition" }
    });
  });

  it("cancels a running turn once and finishes it from cancelling", () => {
    expect(tags(value(ready().cancel()))).toEqual([]);
    const asked = value(value(ready().startTurn()).state.requestPermission()).state;
    const cancelling = value(asked.cancel());
    expect(cancelling.events).toEqual([{ _tag: "CancelRequested", sessionId: "s1", turn: 1 }]);
    expect(cancelling.state.toSnapshot()).toMatchObject({
      state: "cancelling",
      pendingPermissions: 1
    });
    expect(tags(value(cancelling.state.cancel()))).toEqual([]);
    expect(value(cancelling.state.answerPermission()).state.toSnapshot().state).toBe("cancelling");
    const finished = value(cancelling.state.finishTurn("cancelled"));
    expect(finished.state.toSnapshot()).toMatchObject({ state: "ready", pendingPermissions: 0 });
  });

  it("invalidates the binding and closes when a cancel does not settle", () => {
    const cancelling = value(value(ready("chat:1").startTurn()).state.cancel()).state;
    const unsettled = value(cancelling.cancelUnsettled());
    expect(unsettled.events).toEqual([
      { _tag: "BindingInvalidated", sessionId: "s1", sessionKey: "chat:1" },
      { _tag: "SessionEnded", sessionId: "s1", reason: "cancel-unsettled" }
    ]);
    expect(unsettled.state.toSnapshot()).toMatchObject({
      state: "closed",
      closeReason: "cancel-unsettled"
    });
    expect(value(ready().startTurn()).state.cancelUnsettled()).toMatchObject({
      ok: false,
      error: { _tag: "IllegalTransition", transition: "cancelUnsettled" }
    });
  });

  it("refuses everything after close, and closing again changes nothing", () => {
    const closed = ready().close("connection-closed");
    expect(closed.events).toEqual([{ _tag: "SessionEnded", sessionId: "s1", reason: "connection-closed" }]);
    const refused = {
      ok: false,
      error: { _tag: "SessionClosed", sessionId: "s1", reason: "connection-closed" }
    };
    expect(closed.state.startTurn()).toEqual(refused);
    expect(closed.state.cancel()).toEqual(refused);
    expect(closed.state.requestPermission()).toEqual(refused);
    expect(closed.state.finishTurn("end_turn")).toEqual(refused);
    expect(closed.state.opened("s2")).toEqual(refused);
    expect(tags(closed.state.close("closed"))).toEqual([]);
  });

  it("restores only snapshots that keep the invariants", () => {
    expect(AcpSession.restore(ready().toSnapshot()).ok).toBe(true);
    for (const snapshot of [
      { agent: "codex", state: "turn", turns: 1, pendingPermissions: 0 },
      { agent: "codex", sessionId: "s1", state: "turn", turns: 0, pendingPermissions: 0 },
      {
        agent: "codex",
        sessionId: "s1",
        state: "awaiting-permission",
        turns: 1,
        pendingPermissions: 0
      },
      { agent: "codex", sessionId: "s1", state: "ready", turns: 1, pendingPermissions: 2 },
      { agent: "codex", sessionId: "s1", state: "closed", turns: 1, pendingPermissions: 0 },
      {
        agent: "codex",
        sessionId: "s1",
        sessionKey: "",
        state: "ready",
        turns: 0,
        pendingPermissions: 0
      }
    ] as const) {
      expect(AcpSession.restore(snapshot)).toMatchObject({
        ok: false,
        error: { _tag: "AcpSessionInvalid" }
      });
    }
  });
});
