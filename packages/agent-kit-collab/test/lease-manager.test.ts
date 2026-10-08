import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { describe, expect, it } from "@effect/vitest";
import { isAgentKitError } from "@rivus/agent-kit/catalog";
import type { Platform, PlatformSqlite } from "@rivus/agent-kit/platform";
import { PlatformService } from "@rivus/agent-kit/platform/effect";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import { afterEach } from "vitest";

import {
  checkFence,
  createLeaseManager,
  fileLeaseRepository,
  type FencingToken,
  type Holder,
  LeaseRepository,
  type LeaseSnapshot,
  memoryLeaseRepository,
  sqliteLeaseRepository
} from "../src/lease/public.js";
import { removeTempDirs, tempDir, testPlatform } from "./support/platform.js";
import { storeCases } from "./support/stores.js";

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
      const hold = (name: string, key: string, ms: number) =>
        Effect.scoped(
          Effect.gen(function* () {
            yield* store.fence(key);
            order.push(`${name}:start`);
            yield* Effect.sleep(ms);
            order.push(`${name}:end`);
          })
        );
      yield* Effect.all([hold("a", KEY, 150), hold("b", KEY, 10), hold("c", "task:2", 10)], {
        concurrency: "unbounded"
      });
      const [first, second] = ["a", "b"].toSorted((x, y) => order.indexOf(`${x}:start`) - order.indexOf(`${y}:start`));
      expect(order.indexOf(`${first}:end`)).toBeLessThan(order.indexOf(`${second}:start`));
      expect(order.indexOf("c:end")).toBeLessThan(order.indexOf("a:end"));
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

  it.live("refuses a second acquisition while the holder keeps renewing", () => {
    const { layer } = make();
    return Effect.gen(function* () {
      const first = yield* createLeaseManager(config);
      const second = yield* createLeaseManager(config);
      const lease = yield* first.acquire(KEY);
      // The second manager starts its observation here; without renewals it would take over after the TTL.
      expect(failureOf(yield* Effect.exit(second.acquire(KEY)))).toMatchObject({ _tag: "LeaseHeld" });
      yield* Effect.sleep(TTL_MS * 2);
      expect(failureOf(yield* Effect.exit(second.acquire(KEY)))).toMatchObject({
        _tag: "LeaseHeld",
        key: KEY,
        generation: lease.token.generation,
        holder: identity(platform)
      });
    }).pipe(Effect.scoped, Effect.provide(layer));
  });

  it.live("takes over a live but silent holder once this observer has seen no renewal for the TTL", () => {
    const { layer } = make();
    return Effect.gen(function* () {
      yield* takeOver(identity(platform), "silent");
      const leases = yield* createLeaseManager(config);
      expect(failureOf(yield* Effect.exit(leases.acquire(KEY)))).toMatchObject({ _tag: "LeaseHeld" });
      yield* Effect.sleep(TTL_MS + 50);
      const lease = yield* leases.acquire(KEY);
      expect(lease.token).toEqual({ key: KEY, generation: 2 });
    }).pipe(Effect.scoped, Effect.provide(layer));
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

  it.live("S62: losing and regaining the lease moves to a new generation, and the old token is refused", () => {
    const { layer } = make();
    return Effect.gen(function* () {
      let lastSeen: FencingToken | undefined;
      const write = (token: FencingToken) =>
        Effect.sync(() => {
          const checked = checkFence(lastSeen, token);
          lastSeen = checked.ok ? checked.value : lastSeen;
          return checked.ok;
        });
      const leases = yield* createLeaseManager(config);
      const old = yield* leases.acquire(KEY);
      expect(yield* old.runFenced(write)).toBe(true);

      yield* takeOver(reusedPid(platform));
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
      expect(checkFence(lastSeen, old.token)).toEqual({
        ok: false,
        error: { _tag: "FenceRejected", key: KEY, generation: 1, current: 3 }
      });
    }).pipe(Effect.scoped, Effect.provide(layer));
  });

  it.live("S64: interrupts fenced work when the lease is lost, and leaves the successor's record alone", () => {
    const { layer } = make();
    return Effect.gen(function* () {
      let interrupted = false;
      let finished = false;
      const successor = yield* Effect.scoped(
        Effect.gen(function* () {
          const leases = yield* createLeaseManager(config);
          const lease = yield* leases.acquire(KEY);
          const fenced = yield* Effect.forkChild(
            lease.runFenced(() =>
              Effect.sleep(5000).pipe(
                Effect.andThen(Effect.sync(() => (finished = true))),
                Effect.onInterrupt(() => Effect.sync(() => (interrupted = true)))
              )
            )
          );
          yield* Effect.sleep(50);
          const next = yield* takeOver(identity(platform));
          expect(failureOf(yield* Fiber.await(fenced))).toMatchObject({ _tag: "LeaseLost", reason: "taken-over" });
          return next;
        })
      );
      expect({ interrupted, finished }).toEqual({ interrupted: true, finished: false });
      const store = yield* LeaseRepository;
      expect(yield* store.load(KEY)).toEqual(successor);
    }).pipe(Effect.provide(layer));
  });

  it.live("refuses fenced work over a record that breaks the lease invariants, instead of trusting its fields", () => {
    const { layer } = make();
    // The first heartbeat of this config is 30 s away, so no renewal can move the record while the test runs.
    const slow = { ttlMs: 60_000, heartbeatMs: 30_000 };
    return Effect.gen(function* () {
      const store = yield* LeaseRepository;
      let ran = false;
      yield* Effect.scoped(
        Effect.gen(function* () {
          const leases = yield* createLeaseManager(slow);
          const lease = yield* leases.acquire(KEY);
          const current = yield* store.load(KEY);
          if (current === undefined) {
            return yield* Effect.die(new Error("the record the lease wrote vanished"));
          }
          yield* store.save(KEY, { ...current, holder: null, revision: current.revision + 1 }, current.revision);
          // The holder id and generation still match, so the old raw-field check ran such work; the restored
          // record breaks the "a holder and a holder id come together" invariant, and none may run over it.
          expect(failureOf(yield* Effect.exit(lease.runFenced(() => Effect.sync(() => (ran = true)))))).toMatchObject({
            _tag: "LeaseRepositoryFailure",
            reason: "invalid-record"
          });
          expect(ran).toBe(false);
        })
      );
    }).pipe(Effect.provide(layer));
  });

  it.live(
    "S67: keeps the fence until an uninterruptible write of a lost holder settles, then runs the successor's work",
    () => {
      const { layer } = make();
      return Effect.gen(function* () {
        const order: string[] = [];
        const old = yield* createLeaseManager(config).pipe(Effect.flatMap((leases) => leases.acquire(KEY)));
        const write = old.runFenced(() =>
          Effect.uninterruptible(
            Effect.tryPromise(async () => {
              order.push("old:start");
              await new Promise((resolve) => setTimeout(resolve, 600));
              order.push("old:end");
            })
          )
        );
        const oldFiber = yield* Effect.forkChild(write);
        yield* Effect.sleep(50);
        yield* takeOver(reusedPid(platform));
        const successor = yield* createLeaseManager(config).pipe(Effect.flatMap((leases) => leases.acquire(KEY)));
        yield* successor.runFenced(() => Effect.sync(() => order.push("new")));
        expect(order).toEqual(["old:start", "old:end", "new"]);
        expect(failureOf(yield* Fiber.await(oldFiber))).toMatchObject({ _tag: "LeaseLost" });
      }).pipe(Effect.scoped, Effect.provide(layer));
    }
  );

  it.live("S67: stops waiting for the fence when the lease is lost", () => {
    const { layer } = make();
    return Effect.gen(function* () {
      const store = yield* LeaseRepository;
      const lease = yield* createLeaseManager(config).pipe(Effect.flatMap((leases) => leases.acquire(KEY)));
      // Another holder's fenced work keeps the fence for a long time.
      yield* Effect.forkChild(Effect.scoped(Effect.andThen(store.fence(KEY), Effect.sleep(5000))));
      yield* Effect.sleep(50);
      let ran = false;
      const waiting = yield* Effect.forkChild(lease.runFenced(() => Effect.sync(() => (ran = true))));
      yield* Effect.sleep(50);
      const lostAt = performance.now();
      yield* takeOver(reusedPid(platform));
      expect(failureOf(yield* Fiber.await(waiting))).toMatchObject({ _tag: "LeaseLost" });
      expect(performance.now() - lostAt).toBeLessThan(HEARTBEAT_MS * 3);
      expect(ran).toBe(false);
    }).pipe(Effect.scoped, Effect.provide(layer));
  });

  it.live("keeps the fence while heartbeats renew the lease under it", () => {
    const { layer } = make();
    return Effect.gen(function* () {
      const leases = yield* createLeaseManager(config);
      const lease = yield* leases.acquire(KEY);
      const before = yield* leases.read(KEY);
      const result = yield* lease.runFenced((token) => Effect.as(Effect.sleep(HEARTBEAT_MS * 3), token.generation));
      expect(result).toBe(1);
      const after = yield* leases.read(KEY);
      expect((after?.revision ?? 0) - (before?.revision ?? 0)).toBeGreaterThanOrEqual(2);
      expect(after?.generation).toBe(1);
    }).pipe(Effect.scoped, Effect.provide(layer));
  });

  it.live("refuses fenced work of a holder that was taken over before the heartbeat noticed", () => {
    const { layer } = make();
    return Effect.gen(function* () {
      const leases = yield* createLeaseManager(config);
      const lease = yield* leases.acquire(KEY);
      yield* takeOver(identity(platform));
      let ran = false;
      const exit = yield* Effect.exit(lease.runFenced(() => Effect.sync(() => (ran = true))));
      // The live heartbeat may notice the takeover before runFenced checks the fence (slow CI runners), so either
      // refusal is correct; what matters is that the old holder's work never runs.
      const failure = failureOf(exit) as { readonly _tag?: string } | undefined;
      if (failure?._tag === "FenceRejected") {
        expect(failure).toEqual({ _tag: "FenceRejected", key: KEY, generation: 1, current: 2 });
      } else {
        expect(failure).toMatchObject({ _tag: "LeaseLost" });
      }
      expect(ran).toBe(false);
    }).pipe(Effect.scoped, Effect.provide(layer));
  });
});

describe("createLeaseManager", () => {
  it.live("judges a holder the platform cannot identify by its TTL instead of failing", () => {
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
    return Effect.gen(function* () {
      yield* takeOver(reusedPid(platform));
      const leases = yield* createLeaseManager(config);
      expect(failureOf(yield* Effect.exit(leases.acquire(KEY)))).toMatchObject({ _tag: "LeaseHeld" });
      yield* Effect.sleep(TTL_MS + 50);
      expect((yield* leases.acquire(KEY)).token.generation).toBe(2);
    }).pipe(Effect.scoped, Effect.provide(layer));
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

describe("fileLeaseRepository", () => {
  const platform = testPlatform({ sqlite: false });
  const layerFor = (dir: string) =>
    Layer.provideMerge(fileLeaseRepository({ dir }), Layer.succeed(PlatformService, platform));
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

  it.live("reports busy instead of waiting without end for a guard that a live, stalled process holds", () => {
    const dir = tempDir();
    const stamp = { ...identity(platform), acquiredAt: 0, nonce: "stalled" };
    writeFileSync(join(dir, "task%3A1.lease.guard"), JSON.stringify(stamp));
    return Effect.gen(function* () {
      const store = yield* LeaseRepository;
      const started = performance.now();
      const exit = yield* Effect.exit(
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
      );
      expect(failureOf(exit)).toMatchObject({ _tag: "LeaseRepositoryFailure", reason: "busy" });
      expect(performance.now() - started).toBeLessThan(3000);
    }).pipe(Effect.provide(layerFor(dir)));
  });

  it.live("keeps waiting through a busy guard when asked to wait, and acquires once the guard is free", () => {
    const dir = tempDir();
    const guard = join(dir, "task%3A1.lease.guard");
    writeFileSync(guard, JSON.stringify({ ...identity(platform), acquiredAt: 0, nonce: "stalled" }));
    return Effect.gen(function* () {
      const leases = yield* createLeaseManager(config);
      const waiting = yield* Effect.forkChild(
        Effect.scoped(Effect.map(leases.acquire(KEY, { wait: true }), (lease) => lease.token.generation))
      );
      // Longer than the guard's 1 s bound, so the first attempts end as busy.
      yield* Effect.sleep(1500);
      rmSync(guard);
      expect(yield* Fiber.join(waiting)).toBe(1);
    }).pipe(Effect.provide(layerFor(dir)));
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
