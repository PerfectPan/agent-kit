import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { describe, expect, it } from "@effect/vitest";
import { isAgentKitError } from "@rivus/agent-kit/catalog";
import type { Platform } from "@rivus/agent-kit/platform";
import { PlatformService } from "@rivus/agent-kit/platform/effect";
import * as Cause from "effect/Cause";
import * as Clock from "effect/Clock";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Queue from "effect/Queue";
import { TestClock } from "effect/testing";
import { afterEach } from "vite-plus/test";

import {
  createLeaseManager,
  fileLeaseRepository,
  type Holder,
  LeaseRepository,
  type LeaseSnapshot,
  memoryLeaseRepository,
  sqliteLeaseRepository
} from "../src/lease/public.js";
import { revisionConflict } from "../src/lease/application/services/repository-failure.js";
import { manualClock, removeTempDirs, tempDir, testPlatform } from "./support/platform.js";
import { storeCases } from "./support/stores.js";

import { FencingToken, type FencingTokenSnapshot } from "../src/lease/domain/lease/value-objects/fencing-token.js";

type PlatformSqlite = NonNullable<Platform["sqlite"]>;

type LeaseRepositoryShape = Effect.Success<typeof LeaseRepository>;

const KEY = "task:1";
const TTL_MS = 300;
const HEARTBEAT_MS = 100;
const config = { ttlMs: TTL_MS, heartbeatMs: HEARTBEAT_MS, retryMs: 20 };

afterEach(() => {
  removeTempDirs();
});

function identity(platform: Platform): Holder {
  const { host, bootId, pid, startTime } = platform.process.self;
  return { host, bootId, pid, startTime };
}

/** This process's pid with another start time: what a holder whose pid was reused looks like. */
function reusedPid(platform: Platform): Holder {
  return { ...identity(platform), startTime: identity(platform).startTime - 1 };
}

/**
 * Another process takes the lease over by writing straight into the repository, as its own manager would. The
 * holder's heartbeat may write between the read and the write, so it tries again, like a manager's acquisition.
 */
const takeOver = (holder: Holder, holderId = "other") =>
  Effect.gen(function* () {
    const store = yield* LeaseRepository;
    for (let turn = 0; turn < 10; turn += 1) {
      const current = yield* store.load(KEY);
      const next: LeaseSnapshot = {
        key: KEY,
        generation: (current?.generation ?? 0) + 1,
        revision: (current?.revision ?? 0) + 1,
        holder,
        holderId,
        renewedAt: 0
      };
      const written = yield* Effect.exit(store.save(KEY, next, current?.revision));
      if (Exit.isSuccess(written)) {
        return next;
      }
    }
    return yield* Effect.die(new Error("the record kept changing"));
  });

const failureOf = <A, E>(exit: Exit.Exit<A, E>): unknown =>
  Exit.isFailure(exit) ? Cause.squash(exit.cause) : undefined;

/**
 * Runs `request`, which asks for a fence, so that `onRefused` runs at each of its attempts that found the fence held.
 * A persistent store's fence (`holdProcessLock`) pauses on the Effect clock before it tries again, and only after such
 * an attempt; the memory store's fence waits on a semaphore instead and never runs `onRefused`. The live clock keeps
 * its methods on a class prototype, so they are delegated one by one instead of spread.
 */
const reportingRefusals = <A, E, R>(request: Effect.Effect<A, E, R>, onRefused: Effect.Effect<unknown>) =>
  Clock.clockWith((clock) =>
    Effect.provideService(request, Clock.Clock, {
      currentTimeMillisUnsafe: () => clock.currentTimeMillisUnsafe(),
      currentTimeMillis: clock.currentTimeMillis,
      currentTimeNanosUnsafe: () => clock.currentTimeNanosUnsafe(),
      currentTimeNanos: clock.currentTimeNanos,
      monotonicTimeNanosUnsafe: () => clock.monotonicTimeNanosUnsafe(),
      monotonicTimeNanos: clock.monotonicTimeNanos,
      sleep: (duration) => Effect.andThen(onRefused, clock.sleep(duration))
    })
  );

/** What the code under test did to the store, for a test to wait on instead of sleeping. */
interface StoreEvents {
  /** Every record a save wrote, in order. */
  readonly saved: Queue.Queue<LeaseSnapshot>;
  /** The key of every fence request, offered before the request starts waiting. */
  readonly fenced: Queue.Queue<string>;
  /** The key of every attempt at a fence that found it held; only persistent stores report these. */
  readonly refused: Queue.Queue<string>;
}

/**
 * Runs `body` with the manager's time on the TestClock: heartbeats sleep and TTLs elapse only when the test adjusts
 * it, through `Effect.sleep` and a platform clock that reads the TestClock. The store keeps the live clock, because
 * its guards and fences retry against locks that other fibers and processes hold, and on the TestClock those retries
 * would wait for the next adjustment; nothing asserts on how long they take.
 */
const withTestClock = <A, E, R>(platform: Platform, body: (events: StoreEvents) => Effect.Effect<A, E, R>) =>
  Effect.gen(function* () {
    const store = yield* LeaseRepository;
    const saved = yield* Queue.unbounded<LeaseSnapshot>();
    const fenced = yield* Queue.unbounded<string>();
    const refused = yield* Queue.unbounded<string>();
    const observed: LeaseRepositoryShape = {
      load: (key) => TestClock.withLive(store.load(key)),
      save: (key, next, expectedRevision) =>
        TestClock.withLive(store.save(key, next, expectedRevision)).pipe(Effect.tap(() => Queue.offer(saved, next))),
      fence: (key) =>
        Effect.andThen(
          Queue.offer(fenced, key),
          TestClock.withLive(reportingRefusals(store.fence(key), Queue.offer(refused, key)))
        )
    };
    const clock = yield* TestClock.testClockWith((testClock) =>
      Effect.succeed({
        now: () => testClock.currentTimeMillisUnsafe(),
        monotonic: () => testClock.currentTimeMillisUnsafe()
      })
    );
    return yield* body({ saved, fenced, refused }).pipe(
      Effect.provideService(LeaseRepository, observed),
      Effect.provideService(PlatformService, { ...platform, clock })
    );
  });

/**
 * Lets forked fibers run until each waits on something the test controls. It does not wait for I/O, so only with the
 * memory store has every fiber surely reached its wait afterwards.
 */
const flush = Effect.forEach(Array.from({ length: 50 }), () => Effect.yieldNow, { discard: true });

/**
 * Waits until `request`, a forked fence request, has been refused the fence that another holder keeps, or has ended,
 * which means the fence let it in. A persistent store's request reports its refused attempts through `refused` (see
 * `reportingRefusals`); the memory store's request parks on a semaphore without a trace, and `flush` gets it there.
 */
const refusedOrEnded = (persistent: boolean, refused: Effect.Effect<unknown>, request: Fiber.Fiber<unknown, unknown>) =>
  Effect.raceFirst(persistent ? Effect.asVoid(refused) : flush, Effect.asVoid(Fiber.await(request)));

/** Waits until a save has written `revision`, or a later one, of the record. */
const savedRevision = (events: StoreEvents, revision: number) =>
  Effect.gen(function* () {
    let saved = yield* Queue.take(events.saved);
    while (saved.revision < revision) {
      saved = yield* Queue.take(events.saved);
    }
  });

describe.each(storeCases)("lease with the $name repository", ({ make, persistent, platform }) => {
  it.live("writes records only over the revision it is shown, and conflicts otherwise", () => {
    const { layer } = make();
    return Effect.gen(function* () {
      const store = yield* LeaseRepository;
      const record: LeaseSnapshot = {
        key: KEY,
        generation: 1,
        revision: 1,
        holder: identity(platform),
        holderId: "a",
        renewedAt: 5
      };
      yield* store.save(KEY, record, undefined);
      expect(yield* Effect.flip(store.save(KEY, { ...record, holderId: "b" }, undefined))).toEqual({
        _tag: "RevisionConflict",
        key: KEY,
        expectedRevision: undefined,
        storedRevision: 1
      });
      expect(yield* Effect.flip(store.save(KEY, { ...record, revision: 8 }, 7))).toMatchObject({
        _tag: "RevisionConflict",
        expectedRevision: 7,
        storedRevision: 1
      });
      yield* store.save(KEY, { ...record, revision: 2, holderId: "b" }, 1);
      expect(yield* store.load(KEY)).toEqual({ ...record, revision: 2, holderId: "b" });
      expect(yield* store.load("task:2")).toBeUndefined();
    }).pipe(Effect.provide(layer));
  });

  it.live("runs one fence per key at a time and leaves other keys alone", () => {
    const { layer } = make();
    return Effect.gen(function* () {
      const store = yield* LeaseRepository;
      const order: string[] = [];
      const hold = (name: string, key: string, work: Effect.Effect<void> = Effect.void) =>
        Effect.scoped(
          Effect.gen(function* () {
            yield* store.fence(key);
            order.push(`${name}:start`);
            yield* work;
            order.push(`${name}:end`);
          })
        );
      const holding = yield* Deferred.make<void>();
      const release = yield* Deferred.make<void>();
      const refused = yield* Deferred.make<void>();
      const first = yield* Effect.forkChild(
        hold("a", KEY, Effect.andThen(Deferred.succeed(holding, undefined), Deferred.await(release)))
      );
      yield* Deferred.await(holding);
      const second = yield* Effect.forkChild(reportingRefusals(hold("b", KEY), Deferred.succeed(refused, undefined)));
      // Another key's fence is free while `a` keeps this key's fence; a shared fence would never let `c` start.
      yield* hold("c", "task:2");
      // `b` has asked for the fence that `a` keeps; a fence that let it in would have run it by now.
      yield* refusedOrEnded(persistent, Deferred.await(refused), second);
      expect(order).toEqual(["a:start", "c:start", "c:end"]);
      yield* Deferred.succeed(release, undefined);
      yield* Fiber.join(first);
      yield* Fiber.join(second);
      expect(order).toEqual(["a:start", "c:start", "c:end", "a:end", "b:start", "b:end"]);
    }).pipe(Effect.provide(layer));
  });

  it.live("S37: never moves the generation back across release, re-acquisition and reopening the store", () => {
    const { layer, reopen } = make();
    const generation = Effect.scoped(
      createLeaseManager(config).pipe(
        Effect.flatMap((leases) => leases.acquire(KEY)),
        Effect.map((lease) => lease.token.generation)
      )
    );
    return Effect.gen(function* () {
      expect(yield* generation).toBe(1);
      const leases = yield* createLeaseManager(config);
      expect(yield* leases.read(KEY)).toMatchObject({ generation: 1, revision: 2, holder: null, holderId: null });
      expect(yield* generation).toBe(2);
      if (persistent) {
        expect(yield* generation.pipe(Effect.provide(reopen()))).toBe(3);
      }
    }).pipe(Effect.provide(layer));
  });

  it.effect("refuses a second acquisition while the holder keeps renewing", () => {
    const { layer } = make();
    return withTestClock(platform, (events) =>
      Effect.gen(function* () {
        const first = yield* createLeaseManager(config);
        const second = yield* createLeaseManager(config);
        const lease = yield* first.acquire(KEY);
        // The second manager starts its observation here; without renewals it would take over after the TTL.
        expect(failureOf(yield* Effect.exit(second.acquire(KEY)))).toMatchObject({ _tag: "LeaseHeld" });
        // Two TTLs of heartbeats; each renewal lands before the clock moves on.
        for (let beat = 1; beat <= (TTL_MS * 2) / HEARTBEAT_MS; beat += 1) {
          yield* TestClock.adjust(HEARTBEAT_MS);
          yield* savedRevision(events, 1 + beat);
        }
        expect(failureOf(yield* Effect.exit(second.acquire(KEY)))).toMatchObject({
          _tag: "LeaseHeld",
          key: KEY,
          generation: lease.token.generation,
          holder: identity(platform)
        });
      })
    ).pipe(Effect.scoped, Effect.provide(layer));
  });

  it.effect("takes over a live but silent holder once this observer has seen no renewal for the TTL", () => {
    const { layer } = make();
    return withTestClock(platform, () =>
      Effect.gen(function* () {
        yield* takeOver(identity(platform), "silent");
        const leases = yield* createLeaseManager(config);
        expect(failureOf(yield* Effect.exit(leases.acquire(KEY)))).toMatchObject({ _tag: "LeaseHeld" });
        yield* TestClock.adjust(TTL_MS - 1);
        expect(failureOf(yield* Effect.exit(leases.acquire(KEY)))).toMatchObject({ _tag: "LeaseHeld" });
        yield* TestClock.adjust(1);
        const lease = yield* leases.acquire(KEY);
        expect(lease.token).toEqual({ key: KEY, generation: 2 });
      })
    ).pipe(Effect.scoped, Effect.provide(layer));
  });

  it.live("S63: takes over at once from a holder whose pid now belongs to another process", () => {
    const { layer } = make();
    return Effect.gen(function* () {
      yield* takeOver(reusedPid(platform));
      const leases = yield* createLeaseManager(config);
      const lease = yield* leases.acquire(KEY);
      expect(lease.token.generation).toBe(2);
    }).pipe(Effect.scoped, Effect.provide(layer));
  });

  it.effect("S62: losing and regaining the lease moves to a new generation, and the old token is refused", () => {
    const { layer } = make();
    return withTestClock(platform, () =>
      Effect.gen(function* () {
        let lastSeen: FencingTokenSnapshot | undefined;
        const write = (token: FencingTokenSnapshot) =>
          Effect.sync(() => {
            const checked = new FencingToken(token).checkFence(
              lastSeen === undefined ? undefined : new FencingToken(lastSeen)
            );
            lastSeen = checked.ok ? checked.value.toSnapshot() : lastSeen;
            return checked.ok;
          });
        const leases = yield* createLeaseManager(config);
        const old = yield* leases.acquire(KEY);
        expect(yield* old.runFenced(write)).toBe(true);

        yield* takeOver(reusedPid(platform));
        // The next heartbeat finds the takeover.
        yield* TestClock.adjust(HEARTBEAT_MS);
        expect(failureOf(yield* Effect.exit(old.lost))).toEqual({
          _tag: "LeaseLost",
          key: KEY,
          generation: 1,
          reason: "taken-over"
        });

        const again = yield* leases.acquire(KEY);
        expect(again.token.generation).toBe(3);
        expect(yield* again.runFenced(write)).toBe(true);
        expect(failureOf(yield* Effect.exit(old.runFenced(write)))).toMatchObject({ _tag: "LeaseLost", generation: 1 });
        expect(
          new FencingToken(old.token).checkFence(lastSeen === undefined ? undefined : new FencingToken(lastSeen))
        ).toEqual({
          ok: false,
          error: { _tag: "FenceRejected", key: KEY, generation: 1, current: 3 }
        });
      })
    ).pipe(Effect.scoped, Effect.provide(layer));
  });

  it.effect("S64: interrupts fenced work when the lease is lost, and leaves the successor's record alone", () => {
    const { layer } = make();
    return withTestClock(platform, () =>
      Effect.gen(function* () {
        let interrupted = false;
        let finished = false;
        const successor = yield* Effect.scoped(
          Effect.gen(function* () {
            const leases = yield* createLeaseManager(config);
            const lease = yield* leases.acquire(KEY);
            const started = yield* Deferred.make<void>();
            const fenced = yield* Effect.forkChild(
              lease.runFenced(() =>
                Deferred.succeed(started, undefined).pipe(
                  Effect.andThen(Effect.sleep(5000)),
                  Effect.andThen(Effect.sync(() => (finished = true))),
                  Effect.onInterrupt(() => Effect.sync(() => (interrupted = true)))
                )
              )
            );
            yield* Deferred.await(started);
            const next = yield* takeOver(identity(platform));
            // The next heartbeat finds the takeover; the work's 5 s on the TestClock never pass.
            yield* TestClock.adjust(HEARTBEAT_MS);
            expect(failureOf(yield* Fiber.await(fenced))).toMatchObject({ _tag: "LeaseLost", reason: "taken-over" });
            return next;
          })
        );
        expect({ interrupted, finished }).toEqual({ interrupted: true, finished: false });
        const store = yield* LeaseRepository;
        expect(yield* store.load(KEY)).toEqual(successor);
      })
    ).pipe(Effect.provide(layer));
  });

  it.effect(
    "refuses fenced work over a record that breaks the lease invariants, instead of trusting its fields",
    () => {
      const { layer } = make();
      return withTestClock(platform, () =>
        Effect.gen(function* () {
          const store = yield* LeaseRepository;
          let ran = false;
          yield* Effect.scoped(
            Effect.gen(function* () {
              // The TestClock stands still, so no heartbeat moves the record while the test runs.
              const leases = yield* createLeaseManager(config);
              const lease = yield* leases.acquire(KEY);
              const current = yield* store.load(KEY);
              if (current === undefined) {
                return yield* Effect.die(new Error("the record the lease wrote vanished"));
              }
              yield* store.save(KEY, { ...current, holder: null, revision: current.revision + 1 }, current.revision);
              // The holder id and generation still match, so the old raw-field check ran such work; the restored
              // record breaks the "a holder and a holder id come together" invariant, and none may run over it.
              expect(
                failureOf(yield* Effect.exit(lease.runFenced(() => Effect.sync(() => (ran = true)))))
              ).toMatchObject({
                _tag: "LeaseRepositoryFailure",
                reason: "invalid-record"
              });
              expect(ran).toBe(false);
            })
          );
        })
      ).pipe(Effect.provide(layer));
    }
  );

  it.effect(
    "S67: keeps the fence until an uninterruptible write of a lost holder settles, then runs the successor's work",
    () => {
      const { layer } = make();
      return withTestClock(platform, (events) =>
        Effect.gen(function* () {
          const order: string[] = [];
          const started = Promise.withResolvers<void>();
          const settle = Promise.withResolvers<void>();
          const old = yield* createLeaseManager(config).pipe(Effect.flatMap((leases) => leases.acquire(KEY)));
          const write = old.runFenced(() =>
            Effect.uninterruptible(
              Effect.tryPromise(async () => {
                order.push("old:start");
                started.resolve();
                await settle.promise;
                order.push("old:end");
              })
            )
          );
          const oldFiber = yield* Effect.forkChild(write);
          yield* Effect.promise(() => started.promise);
          // The old write's fence request; the next one is the successor's.
          yield* Queue.take(events.fenced);
          yield* takeOver(reusedPid(platform));
          // The next heartbeat finds the takeover, so the old holder has lost the lease while its write still runs.
          yield* TestClock.adjust(HEARTBEAT_MS);
          expect(failureOf(yield* Effect.exit(old.lost))).toMatchObject({ _tag: "LeaseLost" });
          const successor = yield* createLeaseManager(config).pipe(Effect.flatMap((leases) => leases.acquire(KEY)));
          const next = yield* Effect.forkChild(successor.runFenced(() => Effect.sync(() => order.push("new"))));
          // The successor asks for the fence the old write keeps; a fence let go with the lost lease would have run
          // its work by now. Only then does the write settle.
          yield* Queue.take(events.fenced);
          yield* refusedOrEnded(persistent, Queue.take(events.refused), next);
          expect(order).toEqual(["old:start"]);
          settle.resolve();
          yield* Fiber.join(next);
          expect(order).toEqual(["old:start", "old:end", "new"]);
          expect(failureOf(yield* Fiber.await(oldFiber))).toMatchObject({ _tag: "LeaseLost" });
        })
      ).pipe(Effect.scoped, Effect.provide(layer));
    }
  );

  it.effect("S67: stops waiting for the fence when the lease is lost", () => {
    const { layer } = make();
    return withTestClock(platform, (events) =>
      Effect.gen(function* () {
        const store = yield* LeaseRepository;
        const lease = yield* createLeaseManager(config).pipe(Effect.flatMap((leases) => leases.acquire(KEY)));
        // Another holder's fenced work keeps the fence until the test ends.
        const holding = yield* Deferred.make<void>();
        yield* Effect.forkChild(
          Effect.scoped(
            store.fence(KEY).pipe(Effect.andThen(Deferred.succeed(holding, undefined)), Effect.andThen(Effect.never))
          )
        );
        yield* Deferred.await(holding);
        // The holder's fence request; the next one is the waiting fiber's.
        yield* Queue.take(events.fenced);
        let ran = false;
        const waiting = yield* Effect.forkChild(lease.runFenced(() => Effect.sync(() => (ran = true))));
        yield* Queue.take(events.fenced);
        yield* takeOver(reusedPid(platform));
        // One heartbeat finds the takeover. The fence is never released, so only the loss can end the wait.
        yield* TestClock.adjust(HEARTBEAT_MS);
        expect(failureOf(yield* Fiber.await(waiting))).toMatchObject({ _tag: "LeaseLost" });
        expect(ran).toBe(false);
      })
    ).pipe(Effect.scoped, Effect.provide(layer));
  });

  it.effect("keeps the fence while heartbeats renew the lease under it", () => {
    const { layer } = make();
    return withTestClock(platform, (events) =>
      Effect.gen(function* () {
        const leases = yield* createLeaseManager(config);
        const lease = yield* leases.acquire(KEY);
        const started = yield* Deferred.make<void>();
        const done = yield* Deferred.make<void>();
        const work = yield* Effect.forkChild(
          lease.runFenced((token) =>
            Deferred.succeed(started, undefined).pipe(Effect.andThen(Deferred.await(done)), Effect.as(token.generation))
          )
        );
        yield* Deferred.await(started);
        // Two heartbeats renew the lease while the work keeps the fence.
        yield* TestClock.adjust(HEARTBEAT_MS);
        yield* savedRevision(events, 2);
        yield* TestClock.adjust(HEARTBEAT_MS);
        yield* savedRevision(events, 3);
        yield* Deferred.succeed(done, undefined);
        expect(yield* Fiber.join(work)).toBe(1);
        expect(yield* leases.read(KEY)).toMatchObject({ generation: 1, revision: 3 });
      })
    ).pipe(Effect.scoped, Effect.provide(layer));
  });

  it.effect("refuses fenced work of a holder that was taken over before the heartbeat noticed", () => {
    const { layer } = make();
    return withTestClock(platform, () =>
      Effect.gen(function* () {
        const leases = yield* createLeaseManager(config);
        const lease = yield* leases.acquire(KEY);
        yield* takeOver(identity(platform));
        let ran = false;
        // The TestClock stands still, so no heartbeat has noticed the takeover; the fence check refuses the work.
        const exit = yield* Effect.exit(lease.runFenced(() => Effect.sync(() => (ran = true))));
        expect(failureOf(exit)).toEqual({ _tag: "FenceRejected", key: KEY, generation: 1, current: 2 });
        expect(ran).toBe(false);
      })
    ).pipe(Effect.scoped, Effect.provide(layer));
  });
});

describe("createLeaseManager", () => {
  it.effect("judges a holder the platform cannot identify by its TTL instead of failing", () => {
    const platform = testPlatform();
    const failing: Platform = {
      ...platform,
      // The rest of the port is inherited; only looking up another pid fails.
      process: Object.create(platform.process, {
        identify: {
          value: () => {
            throw new Error("ps failed");
          }
        }
      }) as Platform["process"]
    };
    const layer = Layer.provideMerge(memoryLeaseRepository(), Layer.succeed(PlatformService, failing));
    return withTestClock(failing, () =>
      Effect.gen(function* () {
        yield* takeOver(reusedPid(platform));
        const leases = yield* createLeaseManager(config);
        expect(failureOf(yield* Effect.exit(leases.acquire(KEY)))).toMatchObject({ _tag: "LeaseHeld" });
        yield* TestClock.adjust(TTL_MS);
        expect((yield* leases.acquire(KEY)).token.generation).toBe(2);
      })
    ).pipe(Effect.scoped, Effect.provide(layer));
  });

  const layer = Layer.provideMerge(memoryLeaseRepository(), Layer.succeed(PlatformService, testPlatform()));

  it.effect("S65: rejects a heartbeat that does not fit twice into the TTL, and other invalid durations", () =>
    Effect.gen(function* () {
      for (const invalid of [
        { ttlMs: 100, heartbeatMs: 60 },
        { ttlMs: 0, heartbeatMs: 0 },
        { ttlMs: 100, heartbeatMs: 50, retryMs: -1 },
        { ttlMs: Number.NaN, heartbeatMs: 10 }
      ]) {
        expect(failureOf(yield* Effect.exit(createLeaseManager(invalid)))).toMatchObject({
          _tag: "LeaseConfigInvalid"
        });
      }
      expect(Exit.isSuccess(yield* Effect.exit(createLeaseManager({ ttlMs: 100, heartbeatMs: 50 })))).toBe(true);
    }).pipe(Effect.provide(layer))
  );

  it.effect("treats an empty key as a programming error", () =>
    Effect.gen(function* () {
      const leases = yield* createLeaseManager(config);
      const exit = yield* Effect.exit(Effect.scoped(leases.acquire("")));
      expect(Exit.isFailure(exit) && isAgentKitError(Cause.squash(exit.cause))).toBe(true);
    }).pipe(Effect.provide(layer))
  );
});

describe("take loop", () => {
  /**
   * Wraps the memory repository so the first `count` saves report a conflict without writing, then delegates.
   * Deterministic, so the loop's conflict, re-read and retry can be tested without racing writers.
   */
  const layerWithConflicts = (count: number) =>
    Layer.provideMerge(
      Layer.effect(
        LeaseRepository,
        Effect.gen(function* () {
          const inner = yield* LeaseRepository;
          let remaining = count;
          return {
            load: (key: string) => inner.load(key),
            save: (key: string, next: LeaseSnapshot, expectedRevision: number | undefined) => {
              if (remaining > 0) {
                remaining -= 1;
                return Effect.fail(revisionConflict(key, expectedRevision, 1));
              }
              return inner.save(key, next, expectedRevision);
            },
            fence: (key: string) => inner.fence(key)
          };
        })
      ).pipe(Layer.provide(memoryLeaseRepository())),
      Layer.succeed(PlatformService, testPlatform())
    );

  it.effect("retries from a re-read when a save reports a conflict, and writes once", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const leases = yield* createLeaseManager(config);
        expect((yield* leases.acquire(KEY)).token.generation).toBe(1);
        // Exactly one write landed: the conflicting first turn wrote nothing.
        expect(yield* leases.read(KEY)).toMatchObject({ generation: 1, revision: 1 });
      })
    ).pipe(Effect.provide(layerWithConflicts(1)))
  );

  it.effect("still succeeds on the eighth turn after seven conflicting saves", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const leases = yield* createLeaseManager(config);
        expect((yield* leases.acquire(KEY)).token.generation).toBe(1);
        expect(yield* leases.read(KEY)).toMatchObject({ generation: 1, revision: 1 });
      })
    ).pipe(Effect.provide(layerWithConflicts(7)))
  );

  it.effect("reports busy when all eight turns of one acquisition conflict", () =>
    Effect.gen(function* () {
      const leases = yield* createLeaseManager(config);
      expect(failureOf(yield* Effect.exit(Effect.scoped(leases.acquire(KEY))))).toMatchObject({
        _tag: "LeaseRepositoryFailure",
        reason: "busy"
      });
      expect(yield* leases.read(KEY)).toBeUndefined();
    }).pipe(Effect.provide(layerWithConflicts(8)))
  );
});

describe("fileLeaseRepository", () => {
  const platform = testPlatform({ sqlite: false });
  /** How long a save waits for a busy guard; the repository measures it with the platform's monotonic clock. */
  const GUARD_TIMEOUT_MS = 1000;
  const layerFor = (dir: string, on: Platform = platform) =>
    Layer.provideMerge(fileLeaseRepository({ dir }), Layer.succeed(PlatformService, on));
  const acquireOnce = Effect.scoped(
    createLeaseManager(config).pipe(
      Effect.flatMap((leases) => leases.acquire(KEY)),
      Effect.map((lease) => lease.token.generation)
    )
  );

  it.live("refuses an unreadable record or an unknown schema version instead of overwriting it", () => {
    const dir = tempDir();
    const path = join(dir, "task%3A1.lease.json");
    return Effect.gen(function* () {
      writeFileSync(path, "{");
      expect(failureOf(yield* Effect.exit(acquireOnce))).toMatchObject({
        _tag: "LeaseRepositoryFailure",
        reason: "invalid-record"
      });
      writeFileSync(path, JSON.stringify({ schemaVersion: 2, record: {} }));
      expect(failureOf(yield* Effect.exit(acquireOnce))).toMatchObject({
        _tag: "LeaseRepositoryFailure",
        reason: "unsupported-schema"
      });
      expect(readFileSync(path, "utf8")).toBe(JSON.stringify({ schemaVersion: 2, record: {} }));
    }).pipe(Effect.provide(layerFor(dir)));
  });

  // The guard tests move the platform clock by hand; the pauses between attempts on a busy guard keep the live clock
  // and only pace the retries.
  it.live("reports busy instead of waiting without end for a guard that a live, stalled process holds", () => {
    const dir = tempDir();
    const stamp = { ...identity(platform), acquiredAt: 0, nonce: "stalled" };
    writeFileSync(join(dir, "task%3A1.lease.guard"), JSON.stringify(stamp));
    const time = manualClock();
    return Effect.gen(function* () {
      const store = yield* LeaseRepository;
      const waitStarted = time.nextRead();
      const saving = yield* Effect.forkChild(
        Effect.exit(
          store.save(
            KEY,
            {
              key: KEY,
              generation: 1,
              revision: 1,
              holder: identity(platform),
              holderId: "a",
              renewedAt: 0
            },
            undefined
          )
        )
      );
      yield* Effect.promise(() => waitStarted);
      // The guard stays held past the bound, so the save gives up at its next look at the clock.
      time.advance(GUARD_TIMEOUT_MS);
      expect(failureOf(yield* Fiber.join(saving))).toMatchObject({ _tag: "LeaseRepositoryFailure", reason: "busy" });
    }).pipe(Effect.provide(layerFor(dir, { ...platform, clock: time.clock })));
  });

  it.live("keeps waiting through a busy guard when asked to wait, and acquires once the guard is free", () => {
    const dir = tempDir();
    const guard = join(dir, "task%3A1.lease.guard");
    writeFileSync(guard, JSON.stringify({ ...identity(platform), acquiredAt: 0, nonce: "stalled" }));
    const time = manualClock();
    return Effect.gen(function* () {
      const leases = yield* createLeaseManager(config);
      const waitStarted = time.nextRead();
      const waiting = yield* Effect.forkChild(
        Effect.scoped(Effect.map(leases.acquire(KEY, { wait: true }), (lease) => lease.token.generation))
      );
      yield* Effect.promise(() => waitStarted);
      time.advance(GUARD_TIMEOUT_MS);
      // Without a record, only the guard reads the monotonic clock: the first read after the advance ends that wait
      // as busy, and the next one starts the guard wait of the acquisition's retry.
      yield* Effect.promise(() => time.nextRead());
      yield* Effect.promise(() => time.nextRead());
      rmSync(guard);
      expect(yield* Fiber.join(waiting)).toBe(1);
    }).pipe(Effect.provide(layerFor(dir, { ...platform, clock: time.clock })));
  });

  it.live("reclaims a guard file that a dead process left behind", () => {
    const dir = tempDir();
    const stamp = { ...reusedPid(platform), acquiredAt: 0, nonce: "crashed" };
    writeFileSync(join(dir, "task%3A1.lease.guard"), JSON.stringify(stamp));
    return Effect.gen(function* () {
      expect(yield* acquireOnce).toBe(1);
    }).pipe(Effect.provide(layerFor(dir)));
  });
});

describe("sqliteLeaseRepository", () => {
  const platform = testPlatform();

  it.live("rolls back a failed COMMIT, so the retried write can start its transaction", () => {
    const sqlite = platform.sqlite as PlatformSqlite;
    let failCommit = true;
    const flaky: Platform = {
      ...platform,
      sqlite: {
        open(file, options) {
          const db = sqlite.open(file, options);
          return {
            exec(sql) {
              if (sql === "COMMIT" && failCommit && file.endsWith("leases.db")) {
                failCommit = false;
                throw Object.assign(new Error("database is locked"), { errcode: 5 });
              }
              db.exec(sql);
            },
            prepare: (sql) => db.prepare(sql),
            close: () => db.close()
          };
        }
      }
    };
    const path = join(tempDir(), "leases.db");
    const layer = Layer.provideMerge(sqliteLeaseRepository({ path }), Layer.succeed(PlatformService, flaky));
    return Effect.gen(function* () {
      const store = yield* LeaseRepository;
      const record = { key: KEY, generation: 1, revision: 1, holder: null, holderId: null, renewedAt: 0 };
      yield* store.save(KEY, record, undefined);
      expect(failCommit).toBe(false);
      expect(yield* store.load(KEY)).toEqual(record);
    }).pipe(Effect.provide(layer));
  });

  it.live("refuses a database written with a newer schema, and a row that breaks the lease invariants", () => {
    const newer = join(tempDir(), "newer.db");
    const db = new DatabaseSync(newer);
    db.exec("PRAGMA user_version = 2");
    db.close();
    const broken = join(tempDir(), "broken.db");
    const open = (path: string) =>
      Layer.provideMerge(sqliteLeaseRepository({ path }), Layer.succeed(PlatformService, platform));
    return Effect.gen(function* () {
      const exit = yield* Effect.exit(Effect.provide(Effect.void, open(newer)));
      expect(failureOf(exit)).toMatchObject({ _tag: "LeaseRepositoryFailure", reason: "unsupported-schema" });

      yield* Effect.gen(function* () {
        const store = yield* LeaseRepository;
        const record = { key: KEY, generation: 0, revision: 1, holder: null, holderId: null, renewedAt: 0 };
        yield* store.save(KEY, record, undefined);
        const leases = yield* createLeaseManager(config);
        expect(failureOf(yield* Effect.exit(Effect.scoped(leases.acquire(KEY))))).toMatchObject({
          _tag: "LeaseRepositoryFailure",
          reason: "invalid-record"
        });
      }).pipe(Effect.provide(open(broken)));
    });
  });
});
