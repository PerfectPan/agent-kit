import * as Cause from "effect/Cause";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import type * as Scope from "effect/Scope";

import {
  Lane,
  type LaneEvent,
  laneLimits,
  type LaneQueueFull,
  type LanesConfigInvalid,
  type LaneSnapshot,
  type LaneTransition
} from "../../domain/lane/index.js";
import { fromResult } from "../services/from-result.js";

export interface LanesConfig<E, R> {
  /** Activations that may run at once across all keys; a positive integer. */
  readonly maxConcurrent: number;
  /**
   * Lanes that may wait for a free slot; a non-negative integer. A lane waits at most once however often it is woken,
   * so without a bound the queue holds at most one entry per key.
   */
  readonly maxQueued?: number;
  /** The longest one activation may run, in milliseconds, before it is interrupted; no limit when absent. */
  readonly turnTimeoutMs?: number;
  /**
   * The work for one key. It runs in a Scope of its own, closed when it ends, with the context `createLanes` ran in.
   * `cancel`, `close` and the turn timeout interrupt it, and the lane moves on only after its finalizers have run.
   */
  readonly activate: (key: string) => Effect.Effect<unknown, E, R>;
  /**
   * Hears how each activation ended, before the lane can start its next activation. It runs uninterruptibly, and
   * `cancel` and `close` wait for it, so keep it short and do not wait for either of them in it. A defect it raises is
   * logged as a warning.
   */
  readonly onExit?: (exit: ActivationExit<E>) => Effect.Effect<void, never, R>;
}

/** Why the lanes interrupted an activation. */
export type ActivationInterruptReason = "cancel" | "close" | "timeout";

/**
 * How an activation ended. An activation that succeeded or failed by itself is reported so even when a cancel, close
 * or timeout comes while its Scope closes; `ActivationInterrupted` means the lanes cut it short or it never started.
 */
export type ActivationExit<E> =
  | { readonly _tag: "ActivationSucceeded"; readonly key: string }
  /** The activation failed, died, or interrupted itself. */
  | { readonly _tag: "ActivationFailed"; readonly key: string; readonly cause: Cause.Cause<E> }
  | { readonly _tag: "ActivationInterrupted"; readonly key: string; readonly reason: ActivationInterruptReason };

/**
 * `started`: an activation started; `queued`: the lane waits for a free slot; `coalesced`: an activation that has not
 * started yet serves this wake (the queued one, or the one that follows the running one).
 */
export type WakeResult = "started" | "queued" | "coalesced";

/** `close` ran, or the Scope that created the lanes closed. */
export interface LanesClosed {
  readonly _tag: "LanesClosed";
  readonly key: string;
}

export interface LanesStatus {
  readonly running: number;
  readonly queued: number;
  readonly closed: boolean;
  /** Every lane that is not idle: the running ones, then the queued ones in queue order. */
  readonly lanes: readonly LaneSnapshot[];
}

/** Lanes created in a caller's Scope; closing that Scope runs `close`. */
export interface Lanes {
  /**
   * Asks for an activation of `key` without waiting for it. An idle lane starts when a slot is free and nobody waits
   * for one, otherwise it joins the end of the queue, or fails with `LaneQueueFull` when `maxQueued` lanes already
   * wait. A queued or running lane coalesces the wake: at most one more activation follows the running one.
   */
  wake(key: string): Effect.Effect<WakeResult, LaneQueueFull | LanesClosed>;
  /**
   * Drops the wakes `key` owes and interrupts its running activation, then waits until that activation, `onExit`
   * included, has ended. Wakes that arrive after the cancel are served as usual.
   */
  cancel(key: string): Effect.Effect<void>;
  readonly status: Effect.Effect<LanesStatus>;
  /**
   * Refuses later wakes with `LanesClosed`, drops the queue and every pending wake, interrupts the running
   * activations and waits until they have ended. Idempotent.
   */
  readonly close: Effect.Effect<void>;
}

/** An end the activation did not reach by itself: an interruption, by the lanes or its own. */
const cutShort = (exit: Exit.Exit<unknown, unknown>): boolean =>
  Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause);

interface Activation {
  readonly key: string;
  /**
   * Completed with the reason when the lanes stop the activation: by `cancel`, `close` or the turn timer. A Deferred
   * keeps its first value, so the first of them names the reason; its work races against it.
   */
  readonly stop: Deferred.Deferred<ActivationInterruptReason>;
  /** Completed when the activation, `onExit` included, has ended. */
  readonly ended: Deferred.Deferred<void>;
}

/**
 * Creates lanes in the caller's Scope. The lanes capture the context they are created in and give it to every
 * activation; fails with `LanesConfigInvalid` for a limit out of range.
 */
export function createLanes<E = never, R = never>(
  config: LanesConfig<E, R>
): Effect.Effect<Lanes, LanesConfigInvalid, R | Scope.Scope> {
  return Effect.gen(function* () {
    const limits = yield* fromResult(laneLimits(config));
    const context = yield* Effect.context<Exclude<R, Scope.Scope>>();
    const { activate, onExit } = config;
    // Lanes that are not idle, the activations that run, and the keys that wait for a slot. Every change happens in
    // one synchronous step, so no other fiber sees a lane, its activation and the queue disagree.
    const lanes = new Map<string, Lane>();
    const activations = new Map<string, Activation>();
    const queue: string[] = [];
    let closed = false;

    const laneOf = (key: string): Lane => {
      const lane = lanes.get(key);
      if (lane === undefined) {
        throw new Error(`no lane for ${key}`);
      }
      return lane;
    };

    /** Records a transition and returns the activations it started; the caller forks them. */
    const apply = ({ state, events }: LaneTransition): Activation[] => {
      const { key, state: laneState } = state.toSnapshot();
      if (laneState === "idle") {
        lanes.delete(key);
      } else {
        lanes.set(key, state);
      }
      const started: Activation[] = [];
      for (const event of events) {
        switch (event._tag) {
          case "LaneQueued":
            queue.push(key);
            break;
          case "LaneDequeued":
            queue.splice(queue.indexOf(key), 1);
            break;
          case "ActivationStarted": {
            const activation = {
              key,
              stop: Deferred.makeUnsafe<ActivationInterruptReason>(),
              ended: Deferred.makeUnsafe<void>()
            };
            activations.set(key, activation);
            started.push(activation);
            break;
          }
          case "ActivationEnded":
            activations.delete(key);
            break;
          case "WakeCoalesced":
          case "PendingDropped":
            break;
        }
      }
      return started;
    };

    /** Gives the free slots to the lanes that have waited longest. */
    const pump = (): Activation[] => {
      const started: Activation[] = [];
      for (
        let key = queue[0];
        !closed && key !== undefined && activations.size < limits.maxConcurrent;
        key = queue[0]
      ) {
        started.push(...apply(laneOf(key).start()));
      }
      return started;
    };

    const interrupted = (key: string, reason: ActivationInterruptReason): ActivationExit<E> => ({
      _tag: "ActivationInterrupted",
      key,
      reason
    });

    const exitOf = (key: string, exit: Exit.Exit<unknown, E>): ActivationExit<E> =>
      Exit.isSuccess(exit)
        ? { _tag: "ActivationSucceeded", key }
        : { _tag: "ActivationFailed", key, cause: exit.cause };

    /**
     * Runs the work, raced against `stop`; the loser is interrupted and awaited, which for the work includes closing
     * its Scope. `stop` comes first in the race, so an activation stopped before its fiber started never calls
     * `activate`: the race forks its contenders in order and stops at the first that has ended. The turn timer only
     * completes `stop`, so a cancel or close that came first keeps its reason while the cleanup outlasts the deadline.
     */
    const settle = ({ key, stop }: Activation): Effect.Effect<ActivationExit<E>, never, Exclude<R, Scope.Scope>> =>
      Effect.suspend(() => {
        // How `activate` ended, recorded before its Scope closes, and how it ended including that cleanup. A stop or
        // timeout during the cleanup wins the race but must not replace an end the activation reached by itself.
        let body: Exit.Exit<unknown, E> | undefined;
        let work: Exit.Exit<unknown, E> | undefined;
        const record = Effect.scoped(
          Effect.suspend(() => activate(key)).pipe(
            Effect.onExit((exit) =>
              Effect.sync(() => {
                body = exit;
              })
            )
          )
        ).pipe(
          Effect.onExit((exit) =>
            Effect.sync(() => {
              work = exit;
            })
          ),
          Effect.exit
        );
        const raced = Effect.raceFirst(Deferred.await(stop), record);
        const { turnTimeoutMs } = limits;
        const timed =
          turnTimeoutMs === undefined
            ? raced
            : Effect.raceFirst(
                raced,
                Effect.sleep(turnTimeoutMs).pipe(
                  Effect.andThen(Deferred.succeed(stop, "timeout")),
                  Effect.andThen(Effect.never)
                )
              );
        return Effect.map(timed, (result): ActivationExit<E> => {
          if (typeof result !== "string") {
            return exitOf(key, result);
          }
          if (body === undefined || cutShort(body)) {
            return interrupted(key, result);
          }
          // The activation ended by itself and the stop met its cleanup: keep what the cleanup added, such as a
          // finalizer's defect, but not the interruption itself.
          const added = work === undefined || Exit.isSuccess(work) ? [] : work.cause.reasons;
          const own = added.filter((reason) => !Cause.isInterruptReason(reason));
          return exitOf(key, own.length === 0 ? body : Exit.failCause(Cause.fromReasons(own)));
        });
      });

    /**
     * One activation's fiber. It is forked uninterruptible and nothing else holds it, so it always reaches the end of
     * the activation, which frees the slot; only the raced work inside can be interrupted.
     */
    const run = (activation: Activation): Effect.Effect<void> =>
      Effect.gen(function* () {
        const exit = yield* settle(activation);
        if (onExit !== undefined) {
          yield* Effect.scoped(Effect.suspend(() => onExit(exit))).pipe(
            Effect.catchCause((cause) => Effect.logWarning(`lanes: onExit failed for ${exit.key}`, cause))
          );
        }
        yield* Effect.suspend(() => {
          const started = [...apply(laneOf(activation.key).finish()), ...pump()];
          // Completing a Deferred resumes its waiters synchronously, so `cancel` and `close` must find the slot
          // already passed on when they return.
          Deferred.doneUnsafe(activation.ended, Exit.void);
          return fork(started);
        });
      }).pipe(Effect.provideContext(context));

    const fork = (started: readonly Activation[]): Effect.Effect<void> =>
      Effect.forEach(started, (activation) => Effect.forkDetach(run(activation), { uninterruptible: true }), {
        discard: true
      });

    const wakeResult = (events: readonly LaneEvent[]): WakeResult =>
      events.some(({ _tag }) => _tag === "ActivationStarted")
        ? "started"
        : events.some(({ _tag }) => _tag === "LaneQueued")
          ? "queued"
          : "coalesced";

    const close: Effect.Effect<void> = Effect.suspend(() => {
      if (!closed) {
        closed = true;
        // Map iteration tolerates the current entry being replaced or deleted, which is all `apply` does here.
        for (const lane of lanes.values()) {
          apply(lane.cancel());
        }
      }
      const running = [...activations.values()];
      for (const { stop } of running) {
        Deferred.doneUnsafe(stop, Exit.succeed<ActivationInterruptReason>("close"));
      }
      return Effect.forEach(running, ({ ended }) => Deferred.await(ended), { discard: true });
    });

    yield* Effect.addFinalizer(() => close);

    return {
      // Uninterruptible: an activation recorded as started must get its fiber, or its slot would never be freed.
      wake: (key) =>
        Effect.uninterruptible(
          Effect.suspend((): Effect.Effect<WakeResult, LaneQueueFull | LanesClosed> => {
            if (closed) {
              return Effect.fail({ _tag: "LanesClosed", key });
            }
            const woken = (lanes.get(key) ?? Lane.create(key)).wake(
              { running: activations.size, queued: queue.length },
              limits
            );
            if (!woken.ok) {
              return Effect.fail(woken.error);
            }
            return Effect.as(fork(apply(woken.value)), wakeResult(woken.value.events));
          })
        ),
      cancel: (key) =>
        Effect.suspend(() => {
          const lane = lanes.get(key);
          if (lane !== undefined) {
            apply(lane.cancel());
          }
          const activation = activations.get(key);
          if (activation === undefined) {
            return Effect.void;
          }
          Deferred.doneUnsafe(activation.stop, Exit.succeed<ActivationInterruptReason>("cancel"));
          return Deferred.await(activation.ended);
        }),
      status: Effect.sync(() => ({
        running: activations.size,
        queued: queue.length,
        closed,
        lanes: [...activations.keys(), ...queue].map((key) => laneOf(key).toSnapshot())
      })),
      close
    };
  });
}
