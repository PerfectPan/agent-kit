import { describe, expect, it } from "@effect/vitest";
import type { Platform } from "@rivus/agent-kit/platform";
import { PlatformService } from "@rivus/agent-kit/platform/effect";
import { createMemoryPlatform } from "@rivus/agent-kit/testing";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";

import { createLeaseManager, LeaseRepository, memoryLeaseRepository } from "../src/lease/public.js";
import { acquireProcessLock, isProcessLockHeld } from "../src/process-lock/public.js";

const key = "task:edge";
const identity = { host: "box", bootId: "boot", pid: 10, startTime: 100 };
const config = { ttlMs: 300, heartbeatMs: 100 };

function platformWith(self = identity, current: typeof identity | undefined = identity): Platform {
  const platform = createMemoryPlatform();
  return {
    ...platform,
    clock: { now: () => 0, monotonic: () => 0 },
    process: {
      ...platform.process,
      self,
      identify: () => current,
      spawn: () => {
        throw new Error("unexpected process spawn");
      }
    }
  };
}

describe("non-conforming process identities", () => {
  for (const fields of [{ pid: Number.NaN }, { startTime: Number.POSITIVE_INFINITY }]) {
    it.effect(`keeps the memory lease result for self ${Object.keys(fields)[0]}`, () => {
      const self = { ...identity, ...fields };
      return Effect.gen(function* () {
        const manager = yield* createLeaseManager(config);
        yield* Effect.scoped(
          Effect.gen(function* () {
            const handle = yield* manager.acquire(key);
            expect(handle.token).toEqual({ key, generation: 1 });
            expect(yield* manager.read(key)).toMatchObject({ holder: self });
            expect(yield* handle.runFenced(() => Effect.succeed("written"))).toBe("written");
          })
        );
        expect(yield* manager.read(key)).toMatchObject({ holder: null, holderId: null });
      }).pipe(Effect.provide(memoryLeaseRepository()), Effect.provideService(PlatformService, platformWith(self)));
    });

    it(`keeps file-lock judgment for observer ${Object.keys(fields)[0]}`, async () => {
      const platform = platformWith({ ...identity, ...fields });
      const path = "/locks/held.lock";
      await platform.fs.writeAtomic(path, JSON.stringify({ ...identity, acquiredAt: 0, nonce: "old" }));
      expect(await isProcessLockHeld(platform, path)).toBe(true);
      expect(await acquireProcessLock(platform, path)).toMatchObject({ ok: false, error: { _tag: "ProcessLockHeld" } });
    });
  }

  for (const startTime of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
    it.effect(`takes over a holder whose identified startTime is ${startTime}`, () =>
      Effect.gen(function* () {
        const store = yield* LeaseRepository;
        yield* store.save(
          key,
          { key, generation: 1, revision: 1, holder: identity, holderId: "old", renewedAt: 0 },
          undefined
        );
        const manager = yield* createLeaseManager(config);
        const handle = yield* manager.acquire(key);
        expect(handle.token).toEqual({ key, generation: 2 });
      }).pipe(
        Effect.scoped,
        Effect.provide(memoryLeaseRepository()),
        Effect.provideService(PlatformService, platformWith(identity, { ...identity, startTime }))
      )
    );

    it(`reclaims a file holder whose identified startTime is ${startTime}`, async () => {
      const platform = platformWith(identity, { ...identity, startTime });
      const path = "/locks/dead.lock";
      await platform.fs.writeAtomic(path, JSON.stringify({ ...identity, acquiredAt: 0, nonce: "old" }));
      expect(await isProcessLockHeld(platform, path)).toBe(false);
      const acquired = await acquireProcessLock(platform, path);
      expect(acquired.ok).toBe(true);
      if (acquired.ok) {
        await acquired.value.release();
      }
    });
  }
});

it.effect("reports generation exhaustion through the existing invalid-record failure", () =>
  Effect.gen(function* () {
    const store = yield* LeaseRepository;
    yield* store.save(
      key,
      {
        key,
        generation: Number.MAX_SAFE_INTEGER,
        revision: Number.MAX_SAFE_INTEGER,
        holder: null,
        holderId: null,
        renewedAt: 0
      },
      undefined
    );
    const manager = yield* createLeaseManager(config);
    const first = yield* Effect.exit(Effect.scoped(manager.acquire(key)));
    // Older records may already contain an exhausted generation; both paths must use the typed failure channel.
    const exhausted = Exit.isSuccess(first) ? yield* Effect.exit(Effect.scoped(manager.acquire(key))) : first;
    expect(Exit.isFailure(exhausted)).toBe(true);
    if (Exit.isFailure(exhausted)) {
      expect(Cause.hasDies(exhausted.cause)).toBe(false);
      expect(Cause.squash(exhausted.cause)).toMatchObject({
        _tag: "LeaseRepositoryFailure",
        key,
        reason: "invalid-record",
        message: "generation 9007199254740992 is not a positive integer"
      });
    }
  }).pipe(Effect.provide(memoryLeaseRepository()), Effect.provideService(PlatformService, platformWith()))
);

it.effect("leaves an exhausted record untouched when acquisition cannot represent its next generation", () =>
  Effect.gen(function* () {
    const store = yield* LeaseRepository;
    const record = {
      key,
      generation: Number.MAX_SAFE_INTEGER,
      revision: Number.MAX_SAFE_INTEGER,
      holder: null,
      holderId: null,
      renewedAt: 0
    };
    yield* store.save(key, record, undefined);
    const manager = yield* createLeaseManager(config);
    const acquired = yield* Effect.exit(Effect.scoped(manager.acquire(key, { wait: true })));
    expect(Exit.isFailure(acquired)).toBe(true);
    expect(yield* store.load(key)).toEqual(record);
  }).pipe(Effect.provide(memoryLeaseRepository()), Effect.provideService(PlatformService, platformWith()))
);
