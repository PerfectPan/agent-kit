import { createAcpPartTranslator, createStreamFolder, type TranscriptStreamPart } from "@rivus/agent-kit-sessions";
import * as Cause from "effect/Cause";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";

import {
  type AcpSessionSnapshot,
  type CancelUnsettled,
  type PermissionOutcome,
  permissionOutcome,
  type PermissionRequest,
  type PromptBlock,
  type SessionClosed
} from "../../domain/acp-session/index.js";
import {
  type ConnectionState,
  emit,
  endTurn,
  type LiveSession,
  primaryKey,
  type PromptError,
  requestError,
  shutdown,
  step,
  type Turn
} from "./connection.js";
import { fromResult } from "./from-result.js";

/** A live session on a connection. Every operation is refused once the session is closed. */
export interface AcpSessionHandle {
  readonly sessionId: string;
  readonly sessionKey?: string;
  /** The session's state when the Effect runs. */
  readonly snapshot: Effect.Effect<AcpSessionSnapshot>;
  /**
   * Runs one turn and streams its parts: deltas and completed events. A second prompt while a turn runs fails with
   * `TurnInProgress`. Interrupting the stream, or leaving it before it ends, cancels the turn as `cancel` does.
   */
  prompt(blocks: readonly PromptBlock[]): Stream.Stream<TranscriptStreamPart, PromptError>;
  /**
   * Sends `session/cancel` and waits for the turn to end, at most `cancelTimeoutMs`; the turn's stream then ends with
   * a `finish` whose reason is usually `cancelled`. When the turn does not end in time, its binding is removed, the
   * connection is closed and this fails with `CancelUnsettled`. With no turn running it does nothing.
   */
  cancel(): Effect.Effect<void, CancelUnsettled | SessionClosed>;
  /**
   * Cancels a running turn, then closes the session, with `session/close` when the agent supports it. Once started it
   * runs to the end, also when the caller is interrupted, such as a permission callback that closes its own session.
   */
  close(): Effect.Effect<void>;
}

/**
 * A cancel that did not settle: the session closes, the connection with its process ends, and then the session's
 * bindings go, each bounded by the request timeout, so a store that hangs cannot keep the process alive.
 */
function invalidate(conn: ConnectionState, live: LiveSession, turn: Turn): Effect.Effect<CancelUnsettled> {
  return Effect.gen(function* () {
    step(live, live.session.cancelUnsettled());
    const owned = live.turn === turn;
    if (owned) {
      live.turn = undefined;
      Deferred.doneUnsafe(turn.ended, Effect.void);
    }
    shutdown(conn, "cancel-unsettled");
    const { sessionId } = live;
    const sessionKey = primaryKey(live);
    const outcomes = yield* Effect.forEach(
      live.keys,
      (key) =>
        (Option.isSome(conn.bindings)
          ? Effect.exit(conn.bindings.value.remove(key, sessionId)).pipe(Effect.timeoutOption(conn.requestTimeoutMs))
          : Effect.succeed(Option.none())
        ).pipe(
          Effect.map((removed): CancelUnsettled["binding"] =>
            Option.isNone(removed) || Exit.isFailure(removed.value)
              ? "failed"
              : removed.value.value
                ? "removed"
                : "unchanged"
          )
        ),
      { concurrency: "unbounded" }
    );
    const binding = outcomes.includes("failed") ? "failed" : outcomes.includes("removed") ? "removed" : outcomes[0];
    const unsettled: CancelUnsettled = {
      _tag: "CancelUnsettled",
      sessionId,
      ...(sessionKey === undefined ? {} : { sessionKey }),
      timeoutMs: conn.cancelTimeoutMs,
      ...(binding === undefined ? {} : { binding })
    };
    if (owned) {
      Queue.failCauseUnsafe(turn.sink, Cause.fail(unsettled));
    }
    return unsettled;
  });
}

/**
 * The cancel protocol: `session/cancel`, then wait for the turn to end. The deadline covers both steps and the wait
 * cannot be interrupted, so the turn is either settled or invalidated when it returns.
 */
function cancelTurn(conn: ConnectionState, live: LiveSession): Effect.Effect<void, CancelUnsettled | SessionClosed> {
  return Effect.suspend((): Effect.Effect<void, CancelUnsettled | SessionClosed> => {
    const turn = live.turn;
    const cancelled = step(live, live.session.cancel());
    if (!cancelled.ok) {
      return Effect.fail(cancelled.error);
    }
    if (turn === undefined) {
      return Effect.void;
    }
    if (turn.cancelling !== undefined) {
      return Deferred.await(turn.cancelling);
    }
    const outcome = Deferred.makeUnsafe<void, CancelUnsettled>();
    turn.cancelling = outcome;
    Deferred.doneUnsafe(turn.cancelRequested, Effect.void);
    return Effect.gen(function* () {
      const settled = yield* conn.wire
        .cancel(live.sessionId)
        .pipe(Effect.andThen(Deferred.await(turn.ended)), Effect.timeoutOption(conn.cancelTimeoutMs));
      if (Option.isSome(settled)) {
        Deferred.doneUnsafe(outcome, Effect.void);
        return;
      }
      const unsettled = yield* invalidate(conn, live, turn);
      Deferred.doneUnsafe(outcome, Effect.fail(unsettled));
      return yield* Effect.fail(unsettled);
    }).pipe(Effect.uninterruptible);
  });
}

function prompt(
  conn: ConnectionState,
  live: LiveSession,
  blocks: readonly PromptBlock[]
): Stream.Stream<TranscriptStreamPart, PromptError> {
  // `Stream.callback` runs this in a fiber of its own and does not see the fiber fail, so a refusal fails the queue.
  // It cannot be interrupted between starting the turn and registering the finalizer that cancels it.
  return Stream.callback<TranscriptStreamPart, PromptError>((sink) =>
    Effect.gen(function* () {
      yield* fromResult(step(live, live.session.startTurn())).pipe(
        Effect.catchTag("IllegalTransition", (illegal) => Effect.die(illegal))
      );
      const number = live.session.toSnapshot().turns;
      const turn: Turn = {
        sink,
        translator: createAcpPartTranslator(`${number}.`),
        folder: createStreamFolder(),
        ended: Deferred.makeUnsafe(),
        cancelRequested: Deferred.makeUnsafe()
      };
      live.turn = turn;
      // Runs when the stream ends for any reason; only a turn that is still running needs the cancel.
      yield* Effect.addFinalizer(() =>
        Effect.suspend(() => (live.turn === turn ? Effect.ignore(cancelTurn(conn, live)) : Effect.void))
      );
      const sent = [...live.pendingBlocks, ...blocks];
      live.pendingBlocks = [];
      // The request lives in the connection's Scope: a cancelled turn still waits for the agent's answer.
      yield* conn.wire.prompt(live.sessionId, sent).pipe(
        Effect.exit,
        Effect.flatMap((exit) =>
          Effect.sync(() => {
            if (Exit.isSuccess(exit)) {
              endTurn(conn, live, turn, { response: exit.value });
              return;
            }
            const failure = Cause.findErrorOption(exit.cause);
            if (Option.isSome(failure)) {
              endTurn(conn, live, turn, { error: requestError(conn, "session/prompt", failure.value) });
            }
          })
        ),
        Effect.forkIn(conn.scope)
      );
    }).pipe(
      Effect.catch((refused) => Queue.fail(sink, refused)),
      Effect.uninterruptible
    )
  );
}

/** Runs to the end once started, bounded by the cancel deadline and the request timeout. */
function closeSession(conn: ConnectionState, live: LiveSession): Effect.Effect<void> {
  return Effect.gen(function* () {
    if (live.session.toSnapshot().state === "closed") {
      return;
    }
    yield* Effect.ignore(cancelTurn(conn, live));
    if (live.session.toSnapshot().state === "closed") {
      return;
    }
    step(live, { ok: true, value: live.session.close("closed") });
    conn.sessions.delete(live.sessionId);
    if (conn.closed === undefined && conn.features.closeSession) {
      yield* Effect.ignore(conn.wire.closeSession(live.sessionId).pipe(Effect.timeoutOption(conn.requestTimeoutMs)));
    }
  }).pipe(Effect.uninterruptible);
}

/** A handle on `live`; `sessionKey` is the key the caller opened it with, else the session's first key. */
export function sessionHandle(
  conn: ConnectionState,
  live: LiveSession,
  sessionKey: string | undefined = primaryKey(live)
): AcpSessionHandle {
  return {
    sessionId: live.sessionId,
    ...(sessionKey === undefined ? {} : { sessionKey }),
    snapshot: Effect.sync(() => live.session.toSnapshot()),
    prompt: (blocks) => prompt(conn, live, blocks),
    cancel: () => cancelTurn(conn, live),
    close: () => closeSession(conn, live)
  };
}

/** Delivers one `session/update` to the running turn; between turns, such as during a load's replay, it is dropped. */
export function deliverUpdate(conn: ConnectionState, live: LiveSession, update: Record<string, unknown>): void {
  if (live.turn !== undefined) {
    emit(conn, live.turn, live.turn.translator.update(update));
  }
}

/**
 * Answers one permission request. Without a running turn, a callback or an answer, the request is denied; while the
 * turn is cancelling, it is `cancelled`.
 */
export function answerPermission(
  conn: ConnectionState,
  request: PermissionRequest,
  signal: AbortSignal
): Promise<PermissionOutcome> {
  const live = conn.sessions.get(request.sessionId);
  const sessionKey = live === undefined ? undefined : primaryKey(live);
  const full: PermissionRequest = sessionKey === undefined ? request : { ...request, sessionKey };
  const turn = live?.turn;
  const callback = conn.onPermission;
  if (live === undefined || turn === undefined || !step(live, live.session.requestPermission()).ok) {
    return Promise.resolve(permissionOutcome(full, undefined, false));
  }
  const cancelling = () => live.session.toSnapshot().state === "cancelling";
  const decide = Effect.gen(function* () {
    if (callback === undefined || cancelling()) {
      return permissionOutcome(full, undefined, cancelling());
    }
    // The callback runs in a fiber of its own and is never waited for once a cancel starts: it may cancel or close
    // this session itself, which waits for the turn to end, and the turn ends only after this request is answered.
    const asking = yield* Effect.forkIn(
      callback(full).pipe(Effect.catchCause(() => Effect.succeed(undefined))),
      conn.scope
    );
    const decision = yield* Effect.raceFirst(
      Fiber.join(asking),
      Deferred.await(turn.cancelRequested).pipe(Effect.as(undefined))
    ).pipe(Effect.ensuring(Effect.sync(() => asking.interruptUnsafe())));
    return permissionOutcome(full, decision, cancelling());
  }).pipe(
    Effect.ensuring(
      Effect.sync(() => {
        if (live.turn === turn) {
          step(live, live.session.answerPermission());
        }
      })
    )
  );
  return conn.runPromise(decide, { signal }).catch(() => permissionOutcome(full, undefined, cancelling()));
}
