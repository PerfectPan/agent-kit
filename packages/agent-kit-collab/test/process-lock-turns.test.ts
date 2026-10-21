import { symlinkSync } from "node:fs";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import type { Platform } from "@rivus/agent-kit/platform";

import { acquireProcessLock, type ProcessLock } from "../src/process-lock/public.js";
type ProcessLockHeld = Extract<Awaited<ReturnType<typeof acquireProcessLock>>, { ok: false }>["error"];
import { removeTempDirs, tempDir, testPlatform } from "./support/platform.js";

type Mechanism = "sqlite" | "file";

interface Pause {
  /** Resolves once a call has reached the paused step. */
  readonly reached: Promise<void>;
  readonly open: () => void;
}

interface Spied {
  readonly platform: Platform;
  /** Attempts on the lock itself: SQLite databases opened for writing, or lock files created. */
  readonly attempts: () => number;
  /** Resolves once every acquisition started so far has joined the queue or started its attempt. */
  readonly settled: () => Promise<void>;
  /** Stops the next path lookups, which every acquisition makes before it takes its turn, until `open` is called. */
  readonly pauseLookups: () => Pause;
  /** Stops the next file writes, which every attempt makes once it has the lock, until `open` is called. */
  readonly pauseWrites: () => Pause;
}

/** A step that calls pass straight through; after `pause`, they stop there until the pause is opened. */
function pausable(): { readonly pass: () => Promise<void>; readonly pause: () => Pause } {
  let paused: { readonly reach: () => void; readonly opened: Promise<void> } | undefined;
  return {
    async pass() {
      if (paused !== undefined) {
        paused.reach();
        await paused.opened;
      }
    },
    pause() {
      const reached = Promise.withResolvers<void>();
      const opened = Promise.withResolvers<void>();
      paused = { reach: reached.resolve, opened: opened.promise };
      return {
        reached: reached.promise,
        open: () => {
          paused = undefined;
          opened.resolve();
        }
      };
    }
  };
}

/** The Node platform, counting attempts and lookups, with lookups and writes that a test can pause. */
function spied(mechanism: Mechanism): Spied {
  const node = testPlatform({ sqlite: mechanism === "sqlite" });
  const { fs, sqlite } = node;
  let attempts = 0;
  const lookups: Promise<unknown>[] = [];
  const lookup = pausable();
  const write = pausable();
  const platform: Platform = {
    ...node,
    fs: {
      ...fs,
      realpath(path) {
        const found = lookup.pass().then(() => fs.realpath(path));
        lookups.push(found);
        return found;
      },
      createExclusive(path) {
        attempts += 1;
        return fs.createExclusive(path);
      },
      async writeAtomic(path, data, options) {
        await write.pass();
        await fs.writeAtomic(path, data, options);
      }
    },
    sqlite: sqlite && {
      open(path, options) {
        if (options?.readonly !== true) {
          attempts += 1;
        }
        return sqlite.open(path, options);
      }
    }
  };
  return {
    platform,
    attempts: () => attempts,
    settled: async () => {
      await Promise.all(lookups);
      // Every acquisition continues from its lookup in microtasks, which all run before the next macrotask.
      await new Promise((resolve) => setImmediate(resolve));
    },
    pauseLookups: lookup.pause,
    pauseWrites: write.pause
  };
}

function held(result: { readonly ok: true; readonly value: ProcessLock } | { readonly ok: false }): ProcessLock {
  if (!result.ok) {
    throw new Error("not acquired");
  }
  return result.value;
}

beforeEach(() => {
  // No acquisition here should ever back off or settle a race: those waits run on timers, which never fire now.
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
});

afterEach(() => {
  vi.useRealTimers();
  removeTempDirs();
});

describe.each(["sqlite", "file"] as const)("acquireProcessLock in one process with %s", (mechanism) => {
  it("S69: gives concurrent acquisitions the lock one at a time, each with a single attempt", async () => {
    const { platform, attempts } = spied(mechanism);
    const path = join(tempDir(), "daemon.lock");
    let holding = 0;
    let most = 0;
    const work = async () => {
      const lock = held(await acquireProcessLock(platform, path, { wait: true }));
      holding += 1;
      most = Math.max(most, holding);
      // Holds across a turn of the event loop, so the others run while it holds the lock.
      await new Promise((resolve) => setImmediate(resolve));
      holding -= 1;
      await lock.release();
    };
    await Promise.all(Array.from({ length: 8 }, work));
    expect(most).toBe(1);
    // An acquisition that met a held lock would have attempted again after a timer.
    expect(attempts()).toBe(8);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("S69: queues acquisitions with no attempt while one here holds the lock, and hands it on in order", async () => {
    const { platform, attempts, settled } = spied(mechanism);
    const path = join(tempDir(), "daemon.lock");
    const first = held(await acquireProcessLock(platform, path));
    const second = acquireProcessLock(platform, path, { wait: true });
    await settled();
    const third = acquireProcessLock(platform, path, { wait: true });
    await settled();
    expect(attempts()).toBe(1);

    await first.release();
    const secondLock = held(await second);
    expect(attempts()).toBe(2);
    await settled();
    expect(attempts()).toBe(2);

    await secondLock.release();
    const thirdLock = held(await third);
    expect(attempts()).toBe(3);
    await thirdLock.release();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("S69: refuses a call without wait at once, with no attempt, while one here holds or attempts it", async () => {
    const { platform, attempts, pauseWrites } = spied(mechanism);
    const path = join(tempDir(), "daemon.lock");
    const first = held(await acquireProcessLock(platform, path));
    const refusal: ProcessLockHeld = { _tag: "ProcessLockHeld", path, holder: first.holder };
    expect(await acquireProcessLock(platform, path)).toEqual({ ok: false, error: refusal });
    expect(attempts()).toBe(1);
    await first.release();

    // The next acquisition stops in its attempt before it records itself, so the refusal finds no holder recorded.
    const writes = pauseWrites();
    const attempting = acquireProcessLock(platform, path);
    await writes.reached;
    expect(await acquireProcessLock(platform, path)).toEqual({ ok: false, error: { ...refusal, holder: undefined } });
    expect(attempts()).toBe(2);
    writes.open();
    await held(await attempting).release();
  });

  it("S69: rejects a queued acquisition when its signal aborts, and keeps the turns of the others", async () => {
    const { platform, attempts, settled } = spied(mechanism);
    const path = join(tempDir(), "daemon.lock");
    const first = held(await acquireProcessLock(platform, path));
    const stop = new AbortController();
    const reason = new Error("stop");
    const aborted = acquireProcessLock(platform, path, { wait: true, signal: stop.signal });
    await settled();
    const last = acquireProcessLock(platform, path, { wait: true });
    await settled();

    stop.abort(reason);
    await expect(aborted).rejects.toBe(reason);
    await settled();
    // The last one still waits for the holder: the abort handed it no turn.
    expect(attempts()).toBe(1);
    await first.release();
    await held(await last).release();
    expect(attempts()).toBe(2);
  });

  it("S69: rejects at once an acquisition aborted while it resolves the path, without joining the queue", async () => {
    const { platform, attempts, settled, pauseLookups } = spied(mechanism);
    const path = join(tempDir(), "daemon.lock");
    const first = held(await acquireProcessLock(platform, path));
    const stop = new AbortController();
    const reason = new Error("stop");
    const lookups = pauseLookups();
    let outcome: unknown;
    void acquireProcessLock(platform, path, { wait: true, signal: stop.signal }).then(
      () => {
        outcome = "acquired";
      },
      (error: unknown) => {
        outcome = error;
      }
    );
    await lookups.reached;
    stop.abort(reason);
    lookups.open();
    await settled();
    // Rejected while the holder still holds the lock: a waiter queued on the aborted signal would hear no abort, and
    // would reject only once the holder handed it the turn.
    expect(outcome).toBe(reason);
    expect(attempts()).toBe(1);
    await first.release();
    // No waiter was left in the queue, so a call without wait finds the turn free.
    await held(await acquireProcessLock(platform, path)).release();
    expect(attempts()).toBe(2);
  });

  it("S69: releases a lock taken after an abort, and hands the turn on", async () => {
    const { platform, attempts, settled, pauseWrites } = spied(mechanism);
    const path = join(tempDir(), "daemon.lock");
    const first = held(await acquireProcessLock(platform, path));
    const stop = new AbortController();
    const reason = new Error("stop");
    const aborted = acquireProcessLock(platform, path, { wait: true, signal: stop.signal });
    await settled();
    const last = acquireProcessLock(platform, path, { wait: true });
    await settled();

    const writes = pauseWrites();
    await first.release();
    // The aborted acquisition has the lock and is recording itself when the signal aborts.
    await writes.reached;
    stop.abort(reason);
    writes.open();
    await expect(aborted).rejects.toBe(reason);
    await held(await last).release();
    expect(attempts()).toBe(3);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("S69: shares turns across platforms with one SQLite and file system, and spellings of one directory", async () => {
    const { platform, attempts } = spied(mechanism);
    const dir = tempDir();
    const link = join(tempDir(), "link");
    symlinkSync(dir, link);
    const first = held(await acquireProcessLock(platform, join(dir, "daemon.lock")));
    const other: Platform = { ...platform };
    expect(await acquireProcessLock(other, `${link}/./daemon.lock`)).toMatchObject({
      ok: false,
      error: { _tag: "ProcessLockHeld", holder: first.holder }
    });
    expect(attempts()).toBe(1);
    await first.release();
  });

  it("S69: keeps platforms over different file systems apart, even for one path", async () => {
    // Each platform sees its own directory as its whole file system, so one path names a different file in each.
    const within = (root: string): Platform => {
      const { fs, sqlite, ...node } = testPlatform({ sqlite: mechanism === "sqlite" });
      const real = (path: string) => join(root, path);
      return {
        ...node,
        fs: {
          ...fs,
          realpath: async (path) => ((await fs.realpath(real(path))) === undefined ? undefined : path),
          read: (path, range) => fs.read(real(path), range),
          writeAtomic: (path, data, options) => fs.writeAtomic(real(path), data, options),
          createExclusive: (path) => fs.createExclusive(real(path)),
          remove: (path) => fs.remove(real(path)),
          stat: (path, options) => fs.stat(real(path), options)
        },
        sqlite: sqlite && { open: (path, options) => sqlite.open(real(path), options) }
      };
    };
    const one = await acquireProcessLock(within(tempDir()), "/daemon.lock");
    const another = await acquireProcessLock(within(tempDir()), "/daemon.lock");
    expect([one.ok, another.ok]).toEqual([true, true]);
    await held(another).release();
    await held(one).release();
  });
});

describe("acquireProcessLock in one process with sqlite when a release fails", () => {
  it("S69: hands the turn on when removing the holder record throws, with the lock released", async () => {
    const { platform, attempts, settled } = spied("sqlite");
    const path = join(tempDir(), "daemon.lock");
    const failure = new Error("cannot remove");
    // The same sqlite object, so it shares the turns of the spied platform.
    const failing: Platform = {
      ...platform,
      fs: {
        ...platform.fs,
        remove: (target) => (target === `${path}.holder` ? Promise.reject(failure) : platform.fs.remove(target))
      }
    };
    const first = held(await acquireProcessLock(failing, path));
    const next = acquireProcessLock(platform, path, { wait: true });
    await settled();
    expect(attempts()).toBe(1);

    await expect(first.release()).rejects.toBe(failure);
    await settled();
    // The waiter has its turn and takes the lock, which the failed release still unlocked, in a single attempt.
    expect(attempts()).toBe(2);
    await held(await next).release();
    expect(vi.getTimerCount()).toBe(0);
  });
});
