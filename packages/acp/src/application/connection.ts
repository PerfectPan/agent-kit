import type { CodingAgentId } from "@rivus/agent-kit-catalog";
import type { ExitStatus } from "@rivus/agent-kit-platform";
import type { AcpPartTranslator, StreamFolder, TranscriptStreamPart } from "@rivus/agent-kit-sessions";
import * as Cause from "effect/Cause";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import type * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import type * as Scope from "effect/Scope";

import type {
  AbsolutePath,
  AcpProfile,
  AcpSession,
  AcpSessionEvent,
  AcpSessionTransition,
  CancelUnsettled,
  PermissionDecision,
  PermissionRequest,
  PromptBlock,
  SessionClosed,
  TurnInProgress
} from "../domain/acp-session/index.js";
import type { AcpRequestFailed, AcpTimeout, AuthMethodInfo, AuthRequired, ConnectionClosed } from "./errors.js";
import type { AcpPlatform, SessionBindingStoreShape } from "./ports.js";
import { type AcpWire, type AgentFeatures, isAuthRequired, type WireFailure } from "./wire.js";

/** How a turn's stream can fail. */
export type PromptError =
  | TurnInProgress
  | SessionClosed
  | CancelUnsettled
  | ConnectionClosed
  | AuthRequired
  | AcpRequestFailed;

/**
 * Answers a permission request with one of its options, or with `undefined` to deny it. The callback runs while the
 * turn waits; it is interrupted when the turn is cancelled, and a failure or a defect counts as a denial.
 */
export type PermissionCallback = (request: PermissionRequest) => Effect.Effect<PermissionDecision | undefined>;

/** The running turn of a session. Its parts go to `sink`, the queue behind the caller's stream. */
export interface Turn {
  readonly sink: Queue.Queue<TranscriptStreamPart, PromptError | Cause.Done>;
  readonly translator: AcpPartTranslator;
  readonly folder: StreamFolder;
  /** Completes when the turn ends, however it ends. */
  readonly ended: Deferred.Deferred<void>;
  /** Completes when a cancel starts, so pending permission requests are answered `cancelled`. */
  readonly cancelRequested: Deferred.Deferred<void>;
  /** The outcome of the cancel in progress, shared by every caller that cancels this turn. */
  cancelling?: Deferred.Deferred<void, CancelUnsettled>;
}

/** One session on the connection: the aggregate's current state and what the running turn needs. */
export interface LiveSession {
  readonly sessionId: string;
  /** The directory the session was opened in. */
  readonly cwd: string;
  /** Keys bound to this session through this connection, the first one first; an unsettled cancel removes each. */
  readonly keys: Set<string>;
  session: AcpSession;
  turn?: Turn;
  /** The system prompt still to send before the first prompt, for agents that read it from the first block. */
  pendingBlocks: readonly PromptBlock[];
  /** The session directory, links resolved, for client file calls; absent when they are off or it does not exist. */
  readonly root?: AbsolutePath;
}

export interface ConnectionState {
  readonly agent: CodingAgentId;
  readonly profile: AcpProfile;
  readonly platform: AcpPlatform;
  readonly cwd: string;
  readonly wire: AcpWire;
  readonly bindings: Option.Option<SessionBindingStoreShape>;
  readonly sessions: Map<string, LiveSession>;
  readonly features: AgentFeatures;
  readonly authMethods: readonly AuthMethodInfo[];
  readonly onPermission?: PermissionCallback;
  readonly fileSystem: { readonly read: boolean; readonly write: boolean };
  readonly requestTimeoutMs: number;
  readonly cancelTimeoutMs: number;
  /**
   * `session/load` and `session/resume` requests in flight, by session id, so concurrent loads of one session send one
   * request and share its LiveSession.
   */
  readonly loading: Map<string, Deferred.Deferred<LiveSession, LoadFailure>>;
  /** The connection's own Scope, a child of the caller's: closing it ends the process. */
  readonly scope: Scope.Closeable;
  readonly ended: Deferred.Deferred<ConnectionClosed>;
  readonly kill: () => void;
  readonly stderr: () => string;
  readonly exit: () => ExitStatus | undefined;
  readonly runPromise: <A>(effect: Effect.Effect<A>, options?: { readonly signal?: AbortSignal }) => Promise<A>;
  closed?: ConnectionClosed;
}

/** How opening a session with the agent can fail, before any binding is written. */
export type LoadFailure = ConnectionClosed | AuthRequired | AcpRequestFailed | AcpTimeout;

/** The key a session is known by: the first one bound to it. */
export function primaryKey(live: LiveSession): string | undefined {
  return live.keys.values().next().value;
}

/** Applies a transition to the session; on a refusal the session keeps its state. */
export function step<E>(
  live: LiveSession,
  result: { readonly ok: true; readonly value: AcpSessionTransition } | { readonly ok: false; readonly error: E }
): { readonly ok: true; readonly value: readonly AcpSessionEvent[] } | { readonly ok: false; readonly error: E } {
  if (!result.ok) {
    return result;
  }
  live.session = result.value.state;
  return { ok: true, value: result.value.events };
}

/** Ends the running turn: a response finishes its stream, a failure fails it. Later calls for that turn do nothing. */
export function endTurn(
  conn: ConnectionState,
  live: LiveSession,
  turn: Turn,
  outcome:
    | { readonly response: { readonly stopReason: string; readonly usage?: unknown } }
    | { readonly error: PromptError }
): void {
  if (live.turn !== turn) {
    return;
  }
  live.turn = undefined;
  if ("response" in outcome) {
    emit(conn, turn, turn.translator.finish(outcome.response));
    step(live, live.session.finishTurn(outcome.response.stopReason));
    Queue.endUnsafe(turn.sink);
  } else {
    step(live, live.session.finishTurn("error"));
    Queue.failCauseUnsafe(turn.sink, Cause.fail(outcome.error));
  }
  Deferred.doneUnsafe(turn.ended, Effect.void);
}

/** Queues parts for the turn's stream, each followed by the events it completes, stamped with the platform clock. */
export function emit(conn: ConnectionState, turn: Turn, parts: readonly TranscriptStreamPart[]): void {
  const ts = conn.platform.clock.now();
  for (const part of parts) {
    Queue.offerUnsafe(turn.sink, part);
    for (const event of turn.folder.push(part, ts)) {
      Queue.offerUnsafe(turn.sink, { type: "event", event });
    }
  }
}

/**
 * Marks the connection ended: every session closes, and every running turn fails with `closed`. Only the first
 * reason counts.
 */
export function markClosed(conn: ConnectionState, closed: ConnectionClosed): ConnectionClosed {
  if (conn.closed !== undefined) {
    return conn.closed;
  }
  conn.closed = closed;
  for (const live of conn.sessions.values()) {
    if (live.turn !== undefined) {
      endTurn(conn, live, live.turn, { error: closed });
    }
    live.session = live.session.close("connection-closed").state;
  }
  Deferred.doneUnsafe(conn.ended, Effect.succeed(closed));
  return closed;
}

/** Ends the connection now: marks it closed, closes the SDK connection and stops the process. */
export function shutdown(conn: ConnectionState, reason: ConnectionClosed["reason"]): ConnectionClosed {
  const closed = markClosed(conn, connectionClosed(conn, reason));
  conn.wire.close();
  conn.kill();
  return closed;
}

export function connectionClosed(conn: ConnectionState, reason: ConnectionClosed["reason"]): ConnectionClosed {
  const exit = conn.exit();
  const stderr = conn.stderr();
  return {
    _tag: "ConnectionClosed",
    agent: conn.agent,
    reason,
    ...(exit === undefined ? {} : { exit }),
    ...(stderr ? { stderr } : {})
  };
}

/** The error for a failed request: the connection ended, the agent wants a login, or the agent refused it. */
export function requestError(
  conn: ConnectionState,
  method: string,
  failure: WireFailure
): ConnectionClosed | AuthRequired | AcpRequestFailed {
  if (failure.kind === "closed") {
    return conn.closed ?? markClosed(conn, connectionClosed(conn, "exited"));
  }
  if (isAuthRequired(failure)) {
    return { _tag: "AuthRequired", agent: conn.agent, authMethods: conn.authMethods, message: failure.message };
  }
  return {
    _tag: "AcpRequestFailed",
    method,
    ...(failure.code === undefined ? {} : { code: failure.code }),
    message: failure.message,
    ...(failure.data === undefined ? {} : { data: failure.data })
  };
}
