import { describe, expect, it } from "@effect/vitest";
import * as Cause from "effect/Cause";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as Logger from "effect/Logger";
import { TestClock } from "effect/testing";

import { type ActivationExit, createLanes, type LanesStatus } from "../src/lanes/public.js";

/**
 * Activations that wait on a gate per key until the test opens it, recording when each starts and when its Scope
 * closes, and the exits the lanes report.
 */
function recorder<E = never>(work: (key: string) => Effect.Effect<void, E> = () => Effect.void) {
  const log: string[] = [];
  const exits: ActivationExit<E>[] = [];
  const gates = new Map<string, Deferred.Deferred<void>>();
  const active = new Map<string, number>();
  let running = 0;
  let peak = 0;
  let overlaps = 0;
  return {
    log,
    exits,
    get peak() {
      return peak;
    },
    get overlaps() {
      return overlaps;
    },
    activate: (key: string) =>
      Effect.gen(function* () {
        const gate = yield* Deferred.make<void>();
        gates.set(key, gate);
        overlaps += (active.get(key) ?? 0) > 0 ? 1 : 0;
        active.set(key, (active.get(key) ?? 0) + 1);
        running += 1;
        peak = Math.max(peak, running);
        log.push(`start ${key}`);
        // The finalizer yields first, like closing a process would: the activation ends after cancel or close
        // started waiting for it.
        yield* Effect.addFinalizer(() =>
          Effect.andThen(
            Effect.yieldNow,
            Effect.sync(() => {
              active.set(key, (active.get(key) ?? 1) - 1);
              running -= 1;
              log.push(`end ${key}`);
            })
          )
        );
        yield* Deferred.await(gate);
        yield* work(key);
      }),
    onExit: (exit: ActivationExit<E>) =>
      Effect.sync(() => {
        exits.push(exit);
      }),
    open: (key: string) => {
      const gate = gates.get(key);
      return gate === undefined ? Effect.die(new Error(`${key} never started`)) : Deferred.succeed(gate, undefined);
    },
    starts: (key: string) => log.filter((entry) => entry === `start ${key}`).length
  };
}

/** Lets the forked activations run until each waits on a gate or the test clock. */
const flush = Effect.forEach(Array.from({ length: 50 }), () => Effect.yieldNow, { discard: true });

const until = (check: () => boolean) =>
  Effect.gen(function* () {
    for (let turn = 0; turn < 1000 && !check(); turn += 1) {
      yield* Effect.yieldNow;
    }
    expect(check()).toBe(true);
  });

const lane = (key: string, state: "queued" | "running", pending: boolean) => ({ key, state, pending });

/** Moves the test clock in steps, letting the fibers run after each. */
const advance = (...steps: number[]) =>
  Effect.forEach(steps, (ms) => Effect.andThen(TestClock.adjust(ms), flush), { discard: true });

function reporter() {
  const exits: ActivationExit<string>[] = [];
  return {
    exits,
    onExit: (exit: ActivationExit<string>) =>
      Effect.sync(() => {
        exits.push(exit);
      })
  };
}

/** An activation whose body takes 90 ms and then ends with `end`, and whose Scope takes 30 ms more to close. */
const slowCleanup = (end: Effect.Effect<void, string>) => () =>
  Effect.gen(function* () {
    yield* Effect.addFinalizer(() => Effect.sleep(30));
    yield* Effect.sleep(90);
    yield* end;
  });

/** Runs one `slowCleanup` activation under a 100 ms turn timeout, which fires while its Scope closes. */
const timedOutDuringCleanup = (end: Effect.Effect<void, string>) =>
  Effect.gen(function* () {
    const { exits, onExit } = reporter();
    const lanes = yield* createLanes({ maxConcurrent: 1, turnTimeoutMs: 100, activate: slowCleanup(end), onExit });
    yield* lanes.wake("a");
    yield* flush;
    yield* advance(90, 10, 20);
    expect(exits).toHaveLength(1);
    return exits[0];
  });

describe("lanes", () => {
  it.effect("S40: coalesces wakes and keeps the queue within maxQueued", () =>
    Effect.gen(function* () {
      const probe = recorder();
      const lanes = yield* createLanes({ maxConcurrent: 1, maxQueued: 1, activate: probe.activate });
      expect(yield* lanes.wake("a")).toBe("started");
      yield* until(() => probe.starts("a") === 1);
      for (let wake = 0; wake < 3; wake += 1) {
        expect(yield* lanes.wake("a")).toBe("coalesced");
      }
      expect(yield* lanes.wake("b")).toBe("queued");
      expect(yield* lanes.wake("b")).toBe("coalesced");
      expect(yield* Effect.flip(lanes.wake("c"))).toEqual({ _tag: "LaneQueueFull", key: "c", maxQueued: 1 });
      expect(yield* lanes.status).toEqual<LanesStatus>({
        running: 1,
        queued: 1,
        closed: false,
        lanes: [lane("a", "running", true), lane("b", "queued", true)]
      });

      // The slot a frees goes to b, which waited; a's pending activation queues behind it.
      yield* probe.open("a");
      yield* until(() => probe.starts("b") === 1);
      expect(yield* lanes.status).toMatchObject({
        running: 1,
        queued: 1,
        lanes: [lane("b", "running", false), lane("a", "queued", true)]
      });
      yield* probe.open("b");
      yield* until(() => probe.starts("a") === 2);
      yield* probe.open("a");
      yield* until(() => probe.log.length === 6);
      expect(probe.log).toEqual(["start a", "end a", "start b", "end b", "start a", "end a"]);
      expect(probe.peak).toBe(1);
      yield* flush;
      expect(yield* lanes.status).toEqual<LanesStatus>({ running: 0, queued: 0, closed: false, lanes: [] });
    })
  );

  it.effect("S100: shares the capacity in wake order, so a re-woken lane waits behind the lanes already queued", () =>
    Effect.gen(function* () {
      const probe = recorder();
      const lanes = yield* createLanes({ maxConcurrent: 2, activate: probe.activate });
      for (const key of ["a", "a", "b", "c"]) {
        yield* lanes.wake(key);
      }
      yield* until(() => probe.starts("b") === 1);
      yield* flush;
      expect(probe.log).toEqual(["start a", "start b"]);

      yield* probe.open("a");
      yield* until(() => probe.starts("c") === 1);
      yield* flush;
      expect(probe.starts("a")).toBe(1);
      yield* probe.open("b");
      yield* until(() => probe.starts("a") === 2);
      yield* probe.open("c");
      yield* probe.open("a");
      yield* until(() => probe.log.length === 8);
      expect(probe.log.filter((entry) => entry.startsWith("start"))).toEqual([
        "start a",
        "start b",
        "start c",
        "start a"
      ]);
      expect(probe.peak).toBe(2);
    })
  );

  it.effect("S101: interrupts an activation that outlives turnTimeoutMs, after which the next one starts", () =>
    Effect.gen(function* () {
      const probe = recorder();
      const lanes = yield* createLanes({
        maxConcurrent: 1,
        turnTimeoutMs: 1000,
        activate: probe.activate,
        onExit: probe.onExit
      });
      yield* lanes.wake("a");
      yield* lanes.wake("b");
      yield* until(() => probe.starts("a") === 1);
      yield* TestClock.adjust(999);
      yield* flush;
      expect(probe.log).toEqual(["start a"]);

      yield* TestClock.adjust(1);
      yield* until(() => probe.starts("b") === 1);
      // a's Scope closed and its exit was reported before b took the slot.
      expect(probe.log).toEqual(["start a", "end a", "start b"]);
      expect(probe.exits).toEqual([{ _tag: "ActivationInterrupted", key: "a", reason: "timeout" }]);

      // b's turn is measured from its own start.
      yield* TestClock.adjust(500);
      yield* probe.open("b");
      yield* until(() => probe.exits.length === 2);
      expect(probe.exits[1]).toEqual({ _tag: "ActivationSucceeded", key: "b" });
    })
  );

  it.effect("S102: cancel drops what a key owes, interrupts its activation and returns once it has ended", () =>
    Effect.gen(function* () {
      const probe = recorder();
      const lanes = yield* createLanes({ maxConcurrent: 1, activate: probe.activate, onExit: probe.onExit });
      for (const key of ["a", "a", "b", "c"]) {
        yield* lanes.wake(key);
      }
      yield* until(() => probe.starts("a") === 1);

      yield* lanes.cancel("b");
      expect((yield* lanes.status).lanes).toEqual([lane("a", "running", true), lane("c", "queued", true)]);

      yield* lanes.cancel("a");
      expect(probe.log).toEqual(["start a", "end a"]);
      expect(probe.exits).toEqual([{ _tag: "ActivationInterrupted", key: "a", reason: "cancel" }]);
      // The slot passed on before cancel returned, and a's pending wake was dropped.
      expect((yield* lanes.status).lanes).toEqual([lane("c", "running", false)]);
      yield* until(() => probe.starts("c") === 1);

      // A key with nothing running cancels at once, and a wake after a cancel is served.
      yield* lanes.cancel("idle");
      expect(yield* lanes.wake("a")).toBe("queued");
      yield* probe.open("c");
      yield* until(() => probe.starts("a") === 2);
      yield* probe.open("a");
      yield* until(() => probe.exits.length === 3);
      expect(probe.log.filter((entry) => entry.startsWith("start"))).toEqual(["start a", "start c", "start a"]);
    })
  );

  it.effect("S103: close interrupts running activations, drops the queue and refuses later wakes", () =>
    Effect.gen(function* () {
      const probe = recorder();
      const lanes = yield* createLanes({ maxConcurrent: 2, activate: probe.activate, onExit: probe.onExit });
      for (const key of ["a", "b", "c", "a"]) {
        yield* lanes.wake(key);
      }
      yield* until(() => probe.starts("b") === 1);

      yield* lanes.close;
      expect(probe.log.toSorted()).toEqual(["end a", "end b", "start a", "start b"]);
      expect(probe.exits.toSorted((x, y) => x.key.localeCompare(y.key))).toEqual([
        { _tag: "ActivationInterrupted", key: "a", reason: "close" },
        { _tag: "ActivationInterrupted", key: "b", reason: "close" }
      ]);
      expect(yield* lanes.status).toEqual<LanesStatus>({ running: 0, queued: 0, closed: true, lanes: [] });
      expect(yield* Effect.flip(lanes.wake("c"))).toEqual({ _tag: "LanesClosed", key: "c" });
      yield* lanes.close;
      yield* flush;
      expect(probe.starts("c")).toBe(0);
    })
  );

  it.effect("S103: closing the Scope that created the lanes closes them", () =>
    Effect.gen(function* () {
      const probe = recorder();
      const lanes = yield* Effect.scoped(
        Effect.gen(function* () {
          const scoped = yield* createLanes({ maxConcurrent: 1, activate: probe.activate, onExit: probe.onExit });
          yield* scoped.wake("a");
          yield* until(() => probe.starts("a") === 1);
          return scoped;
        })
      );
      expect(probe.log).toEqual(["start a", "end a"]);
      expect(probe.exits).toEqual([{ _tag: "ActivationInterrupted", key: "a", reason: "close" }]);
      expect(yield* Effect.flip(lanes.wake("a"))).toEqual({ _tag: "LanesClosed", key: "a" });
    })
  );

  it.effect("S104: reports a failed or dying activation and keeps serving the lane", () =>
    Effect.gen(function* () {
      const modes = ["fail", "throw", "ok"] as const;
      let mode: (typeof modes)[number] = "fail";
      const probe = recorder((key) =>
        mode === "fail"
          ? Effect.fail(`${key} failed`)
          : mode === "throw"
            ? Effect.sync(() => {
                throw new Error(`${key} threw`);
              })
            : Effect.void
      );
      const lanes = yield* createLanes({ maxConcurrent: 1, activate: probe.activate, onExit: probe.onExit });
      for (const [turn, current] of modes.entries()) {
        mode = current;
        yield* lanes.wake("a");
        yield* until(() => probe.starts("a") === turn + 1);
        yield* probe.open("a");
        yield* until(() => probe.exits.length === turn + 1);
      }
      const [failed, died, succeeded] = probe.exits;
      expect(failed?._tag === "ActivationFailed" && Cause.squash(failed.cause)).toBe("a failed");
      expect(died?._tag === "ActivationFailed" && Cause.hasDies(died.cause)).toBe(true);
      expect(succeeded).toEqual({ _tag: "ActivationSucceeded", key: "a" });
      // Each activation's Scope closed before its exit was reported.
      expect(probe.log).toEqual(["start a", "end a", "start a", "end a", "start a", "end a"]);
    })
  );

  it.effect("S104: an activate function that throws before returning an Effect is reported as a defect", () =>
    Effect.gen(function* () {
      const exits: ActivationExit<never>[] = [];
      const lanes = yield* createLanes({
        maxConcurrent: 1,
        activate: () => {
          throw new Error("not an effect");
        },
        onExit: (exit) =>
          Effect.sync(() => {
            exits.push(exit);
          })
      });
      yield* lanes.wake("a");
      yield* until(() => exits.length === 1);
      expect(exits[0]?._tag === "ActivationFailed" && Cause.hasDies(exits[0].cause)).toBe(true);
      expect(yield* lanes.wake("a")).toBe("started");
    })
  );

  it.effect("S104: passes the slot on only after onExit, which cancel waits for, and logs an onExit defect", () => {
    const warnings: { message: unknown; cause: Cause.Cause<unknown> }[] = [];
    const collector = Logger.make(({ logLevel, message, cause }) => {
      if (logLevel === "Warn") {
        warnings.push({ message, cause });
      }
    });
    return Effect.gen(function* () {
      const probe = recorder();
      const reported = yield* Deferred.make<void>();
      const exits: string[] = [];
      const lanes = yield* createLanes({
        maxConcurrent: 1,
        activate: probe.activate,
        onExit: ({ key, _tag }) =>
          key === "a"
            ? Effect.andThen(
                Deferred.await(reported),
                Effect.sync(() => exits.push(`${key} ${_tag}`))
              )
            : Effect.die(new Error("the report failed"))
      });
      yield* lanes.wake("a");
      yield* lanes.wake("b");
      yield* until(() => probe.starts("a") === 1);
      yield* probe.open("a");
      yield* flush;
      expect(probe.log).toEqual(["start a", "end a"]);
      expect((yield* lanes.status).lanes).toEqual([lane("a", "running", false), lane("b", "queued", true)]);

      const cancelled = yield* Effect.forkChild(lanes.cancel("a"));
      yield* flush;
      expect(cancelled.pollUnsafe()).toBeUndefined();
      yield* Deferred.succeed(reported, undefined);
      yield* until(() => probe.starts("b") === 1);
      expect(exits).toEqual(["a ActivationSucceeded"]);
      expect(cancelled.pollUnsafe()).toBeDefined();

      // b's report dies: it is logged, and the lane still serves the next wake.
      yield* probe.open("b");
      yield* flush;
      expect(warnings).toHaveLength(1);
      expect(String(warnings[0]?.message)).toContain("onExit failed for b");
      expect(Cause.squash(warnings[0]?.cause ?? Cause.empty)).toEqual(new Error("the report failed"));
      expect(yield* lanes.wake("b")).toBe("started");
      yield* until(() => probe.starts("b") === 2);
    }).pipe(Effect.provide(Logger.layer([collector])));
  });

  it.effect("S106: reports a success, not a timeout, when the timeout comes while the activation's Scope closes", () =>
    Effect.gen(function* () {
      expect(yield* timedOutDuringCleanup(Effect.void)).toEqual({ _tag: "ActivationSucceeded", key: "a" });
    })
  );

  it.effect("S106: reports a failed prompt as a failure, not a timeout", () =>
    Effect.gen(function* () {
      const exit = yield* timedOutDuringCleanup(Effect.fail("session lost"));
      // The cause is the failure alone, without the interruption that met the cleanup.
      expect(exit?._tag === "ActivationFailed" && exit.cause.reasons).toEqual([Cause.makeFailReason("session lost")]);
    })
  );

  it.effect("S106: keeps a defect the cleanup adds when the timeout meets it, without the interruption", () =>
    Effect.gen(function* () {
      const { exits, onExit } = reporter();
      const lanes = yield* createLanes({
        maxConcurrent: 1,
        turnTimeoutMs: 100,
        onExit,
        activate: () =>
          Effect.gen(function* () {
            yield* Effect.addFinalizer(() => Effect.andThen(Effect.sleep(30), Effect.die("cleanup broke")));
            yield* Effect.sleep(90);
          })
      });
      yield* lanes.wake("a");
      yield* flush;
      yield* advance(90, 10, 20);
      const [exit] = exits;
      expect(exit?._tag === "ActivationFailed" && exit.cause.reasons).toEqual([Cause.makeDieReason("cleanup broke")]);
    })
  );

  it.effect("S108: the first stop names the reason, even when the cleanup it starts outlasts the deadline", () =>
    Effect.gen(function* () {
      const { exits, onExit } = reporter();
      // Three lanes on one clock, each running one activation that never ends by itself and whose Scope takes
      // 100 ms to close, under a 50 ms turn timeout.
      const [first, second, third] = yield* Effect.forEach([1, 2, 3], () =>
        createLanes({
          maxConcurrent: 1,
          turnTimeoutMs: 50,
          onExit,
          activate: () =>
            Effect.andThen(
              Effect.addFinalizer(() => Effect.sleep(100)),
              Effect.never
            )
        })
      );
      if (first === undefined || second === undefined || third === undefined) {
        return yield* Effect.die(new Error("three lanes expected"));
      }
      yield* first.wake("cancelled");
      yield* second.wake("closed");
      yield* third.wake("timed-out");
      yield* flush;
      // A cancel at 10 ms and a close at 45 ms come before the deadline; the third activation's cancel at 60 ms
      // comes after the timeout, while its Scope is still closing.
      yield* advance(10);
      const cancelled = yield* Effect.forkChild(first.cancel("cancelled"));
      yield* advance(35);
      const closed = yield* Effect.forkChild(second.close);
      yield* advance(15);
      const late = yield* Effect.forkChild(third.cancel("timed-out"));
      yield* advance(100);
      yield* Fiber.joinAll([cancelled, closed, late]);
      expect(exits.toSorted((x, y) => x.key.localeCompare(y.key))).toEqual([
        { _tag: "ActivationInterrupted", key: "cancelled", reason: "cancel" },
        { _tag: "ActivationInterrupted", key: "closed", reason: "close" },
        { _tag: "ActivationInterrupted", key: "timed-out", reason: "timeout" }
      ]);
    })
  );

  it.effect("S106: keeps the activation's own exit when cancel or close come while its Scope closes", () =>
    Effect.gen(function* () {
      // A success cancelled during its cleanup, with the turn timeout crossing the cancel.
      const first = reporter();
      const timed = yield* createLanes({
        maxConcurrent: 1,
        turnTimeoutMs: 100,
        activate: slowCleanup(Effect.void),
        onExit: first.onExit
      });
      yield* timed.wake("a");
      yield* flush;
      yield* advance(90, 5);
      const cancelled = yield* Effect.forkChild(timed.cancel("a"));
      yield* advance(5, 20);
      yield* Fiber.join(cancelled);
      expect(first.exits).toEqual([{ _tag: "ActivationSucceeded", key: "a" }]);

      // A failure closed during its cleanup.
      const second = reporter();
      const closing = yield* createLanes({
        maxConcurrent: 1,
        activate: slowCleanup(Effect.fail("session lost")),
        onExit: second.onExit
      });
      yield* closing.wake("b");
      yield* flush;
      yield* advance(95);
      const closed = yield* Effect.forkChild(closing.close);
      yield* advance(25);
      yield* Fiber.join(closed);
      const [failed] = second.exits;
      expect(failed?._tag === "ActivationFailed" && failed.cause.reasons).toEqual([
        Cause.makeFailReason("session lost")
      ]);
    })
  );

  it.effect("S107: a key stopped before its activation started never calls activate", () =>
    Effect.gen(function* () {
      // Woken, then cancelled or closed before the activation's fiber ran.
      const calls: string[] = [];
      const { exits, onExit } = reporter();
      const lanes = yield* createLanes({
        maxConcurrent: 1,
        activate: (key) => Effect.sync(() => calls.push(key)),
        onExit
      });
      expect(yield* lanes.wake("a")).toBe("started");
      yield* lanes.cancel("a");
      expect(yield* lanes.wake("b")).toBe("started");
      yield* lanes.close;
      expect(calls).toEqual([]);
      expect(exits).toEqual([
        { _tag: "ActivationInterrupted", key: "a", reason: "cancel" },
        { _tag: "ActivationInterrupted", key: "b", reason: "close" }
      ]);

      // The cancel passes a's slot to c, and the close that follows at once stops c before it starts.
      const probe = recorder();
      const pumped = yield* createLanes({ maxConcurrent: 1, activate: probe.activate, onExit: probe.onExit });
      yield* pumped.wake("a");
      yield* pumped.wake("c");
      yield* until(() => probe.starts("a") === 1);
      yield* pumped.cancel("a");
      yield* pumped.close;
      expect(probe.starts("c")).toBe(0);
      expect(probe.exits).toEqual([
        { _tag: "ActivationInterrupted", key: "a", reason: "cancel" },
        { _tag: "ActivationInterrupted", key: "c", reason: "close" }
      ]);
    })
  );

  it.effect("S105: refuses limits out of range", () =>
    Effect.gen(function* () {
      for (const limits of [
        { maxConcurrent: 0 },
        { maxConcurrent: 1, maxQueued: -1 },
        { maxConcurrent: 1, turnTimeoutMs: 0 }
      ]) {
        const exit = yield* Effect.exit(createLanes({ ...limits, activate: () => Effect.void }));
        expect(Exit.isFailure(exit) && Cause.squash(exit.cause)).toMatchObject({ _tag: "LanesConfigInvalid" });
      }
    })
  );

  it.effect("keeps every invariant while fibers interleave wakes, cancels, completions, timeouts and close", () =>
    Effect.gen(function* () {
      const maxConcurrent = 2;
      const maxQueued = 2;
      const keys = ["a", "b", "c", "d", "e", "f"];
      let seed = 42;
      const random = (bound: number) => {
        seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
        // The high bits: a power-of-two LCG's low bits repeat with short periods.
        return Math.floor((seed / 2_147_483_648) * bound);
      };
      const gates = new Map<string, Deferred.Deferred<void>>();
      const active = new Map<string, number>();
      const { exits, onExit } = reporter();
      let [running, peak, overlaps, starts, ends, lateStarts] = [0, 0, 0, 0, 0, 0];
      let closing = false;
      const lanes = yield* createLanes({
        maxConcurrent,
        maxQueued,
        turnTimeoutMs: 40,
        onExit,
        activate: (key) =>
          Effect.gen(function* () {
            lateStarts += closing ? 1 : 0;
            starts += 1;
            overlaps += (active.get(key) ?? 0) > 0 ? 1 : 0;
            active.set(key, (active.get(key) ?? 0) + 1);
            running += 1;
            peak = Math.max(peak, running);
            const cleanupMs = random(15);
            yield* Effect.addFinalizer(() =>
              Effect.andThen(
                Effect.sleep(cleanupMs),
                Effect.sync(() => {
                  active.set(key, (active.get(key) ?? 1) - 1);
                  running -= 1;
                  ends += 1;
                })
              )
            );
            const gate = yield* Deferred.make<void>();
            gates.set(key, gate);
            yield* Deferred.await(gate);
            if (random(4) === 0) {
              return yield* Effect.fail("failed");
            }
          })
      });

      let [steps, queueFull, refusedClosed, longestQueue] = [0, 0, 0, 0];
      const check = Effect.gen(function* () {
        const status = yield* lanes.status;
        expect(status.running).toBeLessThanOrEqual(maxConcurrent);
        expect(status.queued).toBeLessThanOrEqual(maxQueued);
        longestQueue = Math.max(longestQueue, status.queued);
        expect(new Set(status.lanes.map((entry) => entry.key)).size).toBe(status.lanes.length);
        // A free slot never stays free while a lane waits.
        expect(status.queued === 0 || status.running === maxConcurrent).toBe(true);
      });
      const worker = Effect.gen(function* () {
        for (let step = 0; step < 150; step += 1) {
          steps += 1;
          const key = keys[random(keys.length)] ?? "a";
          const action = random(20);
          if (action < 9) {
            const woken = yield* Effect.exit(lanes.wake(key));
            const tag = Exit.isFailure(woken) ? (Cause.squash(woken.cause) as { _tag: string })._tag : "ok";
            queueFull += tag === "LaneQueueFull" ? 1 : 0;
            refusedClosed += tag === "LanesClosed" ? 1 : 0;
          } else if (action < 11) {
            yield* Effect.forkChild(lanes.cancel(key));
          } else if (action < 14) {
            const running = (yield* lanes.status).lanes.filter((entry) => entry.state === "running");
            const gate = gates.get(running[random(running.length)]?.key ?? key);
            if (gate !== undefined) {
              yield* Deferred.succeed(gate, undefined);
            }
          } else {
            yield* TestClock.adjust(random(20));
          }
          yield* Effect.yieldNow;
          yield* check;
        }
      });
      let done = false;
      const clock = yield* Effect.forkChild(
        Effect.gen(function* () {
          while (!done) {
            yield* TestClock.adjust(1);
            yield* Effect.yieldNow;
          }
        })
      );
      const workers = yield* Effect.forEach([1, 2, 3], () => Effect.forkChild(worker));
      while (steps < 380) {
        yield* Effect.yieldNow;
      }
      closing = true;
      yield* lanes.close;
      yield* Fiber.joinAll(workers);
      yield* lanes.close;
      done = true;
      yield* Fiber.join(clock);

      expect(yield* lanes.status).toEqual<LanesStatus>({ running: 0, queued: 0, closed: true, lanes: [] });
      expect([overlaps, lateStarts]).toEqual([0, 0]);
      expect(peak).toBe(maxConcurrent);
      expect(longestQueue).toBe(maxQueued);
      expect(ends).toBe(starts);
      expect(queueFull).toBeGreaterThan(0);
      expect(refusedClosed).toBeGreaterThan(0);
      // Every activation is reported once; the ones stopped before they started never called activate.
      expect(exits.length).toBeGreaterThanOrEqual(starts);
      const reasons = new Set(exits.flatMap((exit) => (exit._tag === "ActivationInterrupted" ? [exit.reason] : [])));
      expect(reasons).toEqual(new Set(["cancel", "close", "timeout"]));
      expect(exits.some(({ _tag }) => _tag === "ActivationFailed")).toBe(true);
    })
  );
});
