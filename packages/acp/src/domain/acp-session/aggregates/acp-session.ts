import { type CodingAgentId, err, ok, type Result } from "@rivus/agent-kit-catalog";

import type { AcpSessionInvalid } from "../errors/acp-session-invalid.js";
import type { IllegalTransition } from "../errors/illegal-transition.js";
import type { SessionClosed } from "../errors/session-closed.js";
import type { TurnInProgress } from "../errors/turn-in-progress.js";
import type { AcpSessionEvent } from "../events/acp-session-events.js";
import type { AcpSessionSnapshot, AcpSessionState, SessionCloseReason } from "../value-objects/acp-session-snapshot.js";

export interface CreateAcpSessionInput {
  readonly agent: CodingAgentId;
  readonly sessionKey?: string;
}

export type AcpSessionTransition = { readonly state: AcpSession; readonly events: readonly AcpSessionEvent[] };

const RUNNING: ReadonlySet<AcpSessionState> = new Set(["turn", "awaiting-permission", "cancelling"]);

function invalidity(snapshot: AcpSessionSnapshot): string | undefined {
  const { state, sessionId, sessionKey, turns, pendingPermissions, closeReason } = snapshot;
  if (sessionKey === "") {
    return "the session key is empty";
  }
  if (sessionId === "" || (sessionId === undefined && state !== "starting" && state !== "closed")) {
    return `a ${state} session needs a session id`;
  }
  if (!Number.isSafeInteger(turns) || turns < 0) {
    return `turns ${turns} is not a non-negative integer`;
  }
  if (RUNNING.has(state) && turns === 0) {
    return `a ${state} session has started a turn`;
  }
  if (!Number.isSafeInteger(pendingPermissions) || pendingPermissions < 0) {
    return `pendingPermissions ${pendingPermissions} is not a non-negative integer`;
  }
  if ((state === "awaiting-permission") !== pendingPermissions > 0 && state !== "cancelling") {
    return `a ${state} session cannot have ${pendingPermissions} pending permission requests`;
  }
  return (state === "closed") === (closeReason !== undefined) ? undefined : "only a closed session has a close reason";
}

/**
 * A live ACP session. It starts while the agent creates or loads it, then runs at most one turn at a time; a cancel
 * moves the running turn to `cancelling` until the turn ends, and a cancel that does not settle closes the session and
 * invalidates its binding. A closed session refuses every transition.
 */
export class AcpSession {
  static create(input: CreateAcpSessionInput): Result<AcpSession, AcpSessionInvalid> {
    return AcpSession.restore({
      agent: input.agent,
      ...(input.sessionKey === undefined ? {} : { sessionKey: input.sessionKey }),
      state: "starting",
      turns: 0,
      pendingPermissions: 0
    });
  }

  static restore(snapshot: AcpSessionSnapshot): Result<AcpSession, AcpSessionInvalid> {
    const problem = invalidity(snapshot);
    return problem === undefined
      ? ok(new AcpSession({ ...snapshot }))
      : err({ _tag: "AcpSessionInvalid", message: problem });
  }

  private readonly snapshot: AcpSessionSnapshot;

  private constructor(snapshot: AcpSessionSnapshot) {
    this.snapshot = snapshot;
    Object.freeze(this);
  }

  /** The agent answered `session/new` or `session/load` with this id. */
  opened(sessionId: string): Result<AcpSessionTransition, SessionClosed | IllegalTransition> {
    const refused = this.refuse("opened", ["starting"]);
    if (refused !== undefined) {
      return err(refused);
    }
    if (sessionId === "") {
      return err(this.illegal("opened"));
    }
    return ok(this.next({ sessionId, state: "ready" }, [{ _tag: "SessionOpened", sessionId }]));
  }

  startTurn(): Result<AcpSessionTransition, TurnInProgress | SessionClosed | IllegalTransition> {
    const { state, turns } = this.snapshot;
    if (RUNNING.has(state)) {
      return err({ _tag: "TurnInProgress", sessionId: this.sessionId, turn: turns });
    }
    const refused = this.refuse("startTurn", ["ready"]);
    if (refused !== undefined) {
      return err(refused);
    }
    const turn = turns + 1;
    return ok(this.next({ state: "turn", turns: turn }, [{ _tag: "TurnStarted", sessionId: this.sessionId, turn }]));
  }

  /** The agent asked for permission during the running turn; a cancelling turn stays `cancelling`. */
  requestPermission(): Result<AcpSessionTransition, SessionClosed | IllegalTransition> {
    const refused = this.refuse("requestPermission", [...RUNNING]);
    if (refused !== undefined) {
      return err(refused);
    }
    const { state, pendingPermissions } = this.snapshot;
    return ok(
      this.next(
        {
          state: state === "cancelling" ? "cancelling" : "awaiting-permission",
          pendingPermissions: pendingPermissions + 1
        },
        []
      )
    );
  }

  answerPermission(): Result<AcpSessionTransition, SessionClosed | IllegalTransition> {
    const refused = this.refuse("answerPermission", ["awaiting-permission", "cancelling"]);
    const { state, pendingPermissions } = this.snapshot;
    if (refused !== undefined || pendingPermissions === 0) {
      return err(refused ?? this.illegal("answerPermission"));
    }
    const pending = pendingPermissions - 1;
    const next = state === "cancelling" ? "cancelling" : pending > 0 ? "awaiting-permission" : "turn";
    return ok(this.next({ state: next, pendingPermissions: pending }, []));
  }

  /** Moves a running turn to `cancelling`; with no turn running, or one already cancelling, nothing changes. */
  cancel(): Result<AcpSessionTransition, SessionClosed> {
    const { state, turns } = this.snapshot;
    if (state === "closed") {
      return err(this.closedError());
    }
    if (state !== "turn" && state !== "awaiting-permission") {
      return ok({ state: this, events: [] });
    }
    return ok(
      this.next({ state: "cancelling" }, [{ _tag: "CancelRequested", sessionId: this.sessionId, turn: turns }])
    );
  }

  /** The running turn ended: the agent answered the prompt (`finishReason` is its stop reason) or the request failed. */
  finishTurn(finishReason: string): Result<AcpSessionTransition, SessionClosed | IllegalTransition> {
    const refused = this.refuse("finishTurn", [...RUNNING]);
    if (refused !== undefined) {
      return err(refused);
    }
    const { turns: turn } = this.snapshot;
    return ok(
      this.next({ state: "ready", pendingPermissions: 0 }, [
        { _tag: "TurnFinished", sessionId: this.sessionId, turn, finishReason }
      ])
    );
  }

  /** The cancel deadline passed with the turn still running: the session closes and its binding is invalid. */
  cancelUnsettled(): Result<AcpSessionTransition, SessionClosed | IllegalTransition> {
    const refused = this.refuse("cancelUnsettled", ["cancelling"]);
    if (refused !== undefined) {
      return err(refused);
    }
    const { sessionKey } = this.snapshot;
    const sessionId = this.sessionId;
    return ok(
      this.next({ state: "closed", pendingPermissions: 0, closeReason: "cancel-unsettled" }, [
        { _tag: "BindingInvalidated", sessionId, ...(sessionKey === undefined ? {} : { sessionKey }) },
        { _tag: "SessionEnded", sessionId, reason: "cancel-unsettled" }
      ])
    );
  }

  /** Closes the session from any state; closing a closed session changes nothing. */
  close(reason: SessionCloseReason): AcpSessionTransition {
    if (this.snapshot.state === "closed") {
      return { state: this, events: [] };
    }
    const { sessionId } = this.snapshot;
    return this.next({ state: "closed", pendingPermissions: 0, closeReason: reason }, [
      { _tag: "SessionEnded", ...(sessionId === undefined ? {} : { sessionId }), reason }
    ]);
  }

  toSnapshot(): AcpSessionSnapshot {
    return this.snapshot;
  }

  /** Set in every state but `starting`, and in a `closed` one that was opened first. */
  private get sessionId(): string {
    return this.snapshot.sessionId ?? "";
  }

  private next(change: Partial<AcpSessionSnapshot>, events: readonly AcpSessionEvent[]): AcpSessionTransition {
    const { closeReason: _, ...rest } = this.snapshot;
    const snapshot = { ...rest, ...change };
    return { state: new AcpSession(snapshot), events };
  }

  private refuse(transition: string, from: readonly AcpSessionState[]): SessionClosed | IllegalTransition | undefined {
    if (this.snapshot.state === "closed") {
      return this.closedError();
    }
    return from.includes(this.snapshot.state) ? undefined : this.illegal(transition);
  }

  private closedError(): SessionClosed {
    const { sessionId, closeReason = "closed" } = this.snapshot;
    return { _tag: "SessionClosed", ...(sessionId === undefined ? {} : { sessionId }), reason: closeReason };
  }

  private illegal(transition: string): IllegalTransition {
    return { _tag: "IllegalTransition", transition, state: this.snapshot.state };
  }
}
