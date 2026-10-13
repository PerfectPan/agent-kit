import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, describe, expect, it, onTestFinished, vi } from "vite-plus/test";

import type { Platform, PlatformSqlite } from "@rivus/agent-kit/platform";

import { acquireProcessLock } from "../src/process-lock/public.js";
import { removeTempDirs, tempDir, testPlatform } from "./support/platform.js";
import { startWorker, stopWorkers, WORKER_TEST_TIMEOUT_MS } from "./support/workers.js";

afterEach(async () => {
  await stopWorkers();
  removeTempDirs();
});

describe.each(["sqlite", "file"] as const)("acquireProcessLock with %s", (mechanism) => {
  const platform = testPlatform({ sqlite: mechanism === "sqlite" });

  it(
    "S38: refuses a second process, or makes it wait, until the holder is killed, which frees the lock at once",
    { timeout: WORKER_TEST_TIMEOUT_MS },
    async () => {
      const path = join(tempDir(), "daemon.lock");
      const holder = startWorker("process-lock-worker", [path, mechanism, "hold"]);
      expect(await holder.next("acquired")).toMatchObject({ mechanism });

      const refused = startWorker("process-lock-worker", [path, mechanism, "hold"]);
      expect(await refused.next("held")).toMatchObject({ holderPid: holder.pid });

      const waiting = startWorker("process-lock-worker", [path, mechanism, "wait"]);
      // Printed once two attempts have found the lock held; a wait that took the held lock would print "acquired".
      await waiting.next("waiting");
      expect(waiting.lines.map((line) => line.event)).toEqual(["waiting"]);

      holder.signal("SIGKILL");
      expect(await waiting.next("acquired")).toMatchObject({ pid: waiting.pid });

      // The lock of a killed holder is free at once: a single attempt right after the exit takes it.
      waiting.signal("SIGKILL");
      await waiting.exited;
      const lock = await acquireProcessLock(platform, path);
      expect(lock.ok).toBe(true);
      await (lock.ok ? lock.value.release() : undefined);
    }
  );

  it(
    "S61: lets exactly one of several processes reclaim a lock whose holder died",
    { timeout: WORKER_TEST_TIMEOUT_MS },
    async () => {
      for (let round = 0; round < 3; round += 1) {
        const path = join(tempDir(), "daemon.lock");
        const holder = startWorker("process-lock-worker", [path, mechanism, "hold"]);
        await holder.next("acquired");
        holder.signal("SIGKILL");
        await holder.exited;

        const contenders = Array.from({ length: 4 }, () =>
          startWorker("process-lock-worker", [path, mechanism, "contend"])
        );
        await Promise.all(contenders.map((contender) => contender.next("ready")));
        for (const contender of contenders) {
          contender.send("go");
        }
        const outcomes = await Promise.all(
          contenders.map((contender) =>
            Promise.race([contender.next("acquired"), contender.next("held")]).then((line) => line.event)
          )
        );
        expect(outcomes.filter((event) => event === "acquired")).toHaveLength(1);
        await stopWorkers();
      }
    }
  );

  it("refuses a second acquisition in the same process, and is free again once released", async () => {
    const path = join(tempDir(), "daemon.lock");
    const first = await acquireProcessLock(platform, path);
    if (!first.ok) {
      throw new Error("not acquired");
    }
    expect(first.value).toMatchObject({ path, mechanism, holder: { pid: process.pid } });
    expect(await acquireProcessLock(platform, path)).toMatchObject({
      ok: false,
      error: { _tag: "ProcessLockHeld", path, holder: { pid: process.pid } }
    });
    await first.value.release();
    await first.value.release();
    const second = await acquireProcessLock(platform, path);
    expect(second.ok).toBe(true);
    await (second.ok ? second.value.release() : undefined);
  });

  it("stops waiting when the signal aborts, with its reason", async () => {
    const path = join(tempDir(), "daemon.lock");
    const held = await acquireProcessLock(platform, path);
    const reason = new Error("stop");
    const waiting = acquireProcessLock(platform, path, { wait: true, retryMs: 10, signal: AbortSignal.timeout(100) });
    await expect(waiting).rejects.toMatchObject({ name: "TimeoutError" });
    const aborted = new AbortController();
    aborted.abort(reason);
    await expect(acquireProcessLock(platform, path, { signal: aborted.signal })).rejects.toBe(reason);
    await (held.ok ? held.value.release() : undefined);
  });
});

describe.each(["sqlite", "file"] as const)(
  "acquireProcessLock with %s when the identity cannot be read",
  (mechanism) => {
    it("rejects without taking the lock, so the path stays free", async () => {
      const platform = testPlatform({ sqlite: mechanism === "sqlite" });
      const broken: Platform = {
        ...platform,
        // The rest of the port is inherited; only reading the own identity fails.
        process: Object.create(platform.process, {
          self: {
            get(): never {
              throw new Error("no identity on this platform");
            }
          }
        }) as Platform["process"]
      };
      const path = join(tempDir(), "daemon.lock");
      await expect(acquireProcessLock(broken, path)).rejects.toThrow("no identity");
      const lock = await acquireProcessLock(platform, path);
      expect(lock.ok).toBe(true);
      await (lock.ok ? lock.value.release() : undefined);
    });
  }
);

describe("acquireProcessLock while waiting with SQLite", () => {
  it("backs off between attempts, and only the first one may block the thread", async () => {
    const platform = testPlatform();
    const path = join(tempDir(), "daemon.lock");
    const held = await acquireProcessLock(platform, path);
    const sqlite = platform.sqlite as PlatformSqlite;
    const stop = new AbortController();
    const reason = new Error("stop");
    const timeouts: string[] = [];
    // Its own sqlite object keeps this platform out of the holder's queue in this process, so it meets the held lock
    // in SQLite, as another process would.
    const counting: Platform = {
      ...platform,
      sqlite: {
        open(file, options) {
          const db = sqlite.open(file, options);
          return {
            exec(sql) {
              if (sql.startsWith("PRAGMA busy_timeout")) {
                timeouts.push(sql);
              }
              db.exec(sql);
            },
            prepare: (sql) => db.prepare(sql),
            close: () => db.close()
          };
        }
      }
    };
    // The waits run on fake timers, so the test reads the delays the code asks for instead of timing them; a fixed
    // Math.random makes the jitter factor 1.
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    onTestFinished(() => {
      vi.useRealTimers();
      vi.restoreAllMocks();
    });
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    const timers = vi.spyOn(globalThis, "setTimeout");
    let outcome: unknown;
    void acquireProcessLock(counting, path, { wait: true, retryMs: 10, signal: stop.signal }).then(
      () => {
        outcome = "acquired";
      },
      (error: unknown) => {
        outcome = error;
      }
    );
    // Each attempt reads files for real, so the clock moves only to a timer that the attempt before it has set. The
    // signal aborts while the tenth wait, the first one that the 160 ms cap shortens, is pending.
    while (outcome === undefined) {
      if (vi.getTimerCount() === 0) {
        await new Promise((resolve) => setImmediate(resolve));
      } else if (timers.mock.calls.length < 10) {
        await vi.advanceTimersToNextTimerAsync();
      } else {
        stop.abort(reason);
        await new Promise((resolve) => setImmediate(resolve));
      }
    }
    expect(outcome).toBe(reason);
    // One settling attempt with its four retries 15 ms apart, then waits doubling from 10 ms up to 160 ms between
    // attempts that never block the thread.
    expect(timeouts).toEqual([
      ...Array.from({ length: 5 }, () => "PRAGMA busy_timeout = 10"),
      ...Array.from({ length: 5 }, () => "PRAGMA busy_timeout = 0")
    ]);
    expect(timers.mock.calls.map(([, ms]) => ms)).toEqual([15, 15, 15, 15, 10, 20, 40, 80, 160, 160]);
    await (held.ok ? held.value.release() : undefined);
  });
});

describe("acquireProcessLock with a lock file", () => {
  const platform = testPlatform({ sqlite: false });

  it("records the holder in the lock file and counts a fresh unstamped file as held", async () => {
    const dir = tempDir();
    const path = join(dir, "daemon.lock");
    const lock = await acquireProcessLock(platform, path);
    expect(JSON.parse(readFileSync(path, "utf8"))).toMatchObject({
      pid: process.pid,
      host: platform.process.self.host
    });
    await (lock.ok ? lock.value.release() : undefined);

    const unstamped = join(dir, "unstamped.lock");
    writeFileSync(unstamped, "");
    expect(await acquireProcessLock(platform, unstamped)).toMatchObject({
      ok: false,
      error: { _tag: "ProcessLockHeld", holder: undefined }
    });
  });

  it("does not hold a lock whose stamp a stalled holder overwrote right after it was written", async () => {
    const path = join(tempDir(), "daemon.lock");
    const late = JSON.stringify({ ...platform.process.self, acquiredAt: 0, nonce: "stalled-holder" });
    const overwriting: Platform = {
      ...platform,
      fs: {
        ...platform.fs,
        async writeAtomic(target, data, options) {
          await platform.fs.writeAtomic(target, data, options);
          if (target === path) {
            await platform.fs.writeAtomic(target, late);
          }
        }
      }
    };
    expect(await acquireProcessLock(overwriting, path)).toMatchObject({
      ok: false,
      error: { _tag: "ProcessLockHeld" }
    });
    expect(readFileSync(path, "utf8")).toBe(late);
  });

  it("reclaims a lock file whose pid was reused by another process", async () => {
    const path = join(tempDir(), "daemon.lock");
    const reused = { ...platform.process.self, startTime: platform.process.self.startTime - 1 };
    writeFileSync(path, JSON.stringify({ ...reused, acquiredAt: 0, nonce: "old" }));
    const lock = await acquireProcessLock(platform, path);
    expect(lock.ok).toBe(true);
    await (lock.ok ? lock.value.release() : undefined);
  });
});

describe("acquireProcessLock with SQLite", () => {
  it("writes the holder next to the database for diagnostics and removes it on release", async () => {
    const platform = testPlatform();
    const path = join(tempDir(), "daemon.lock");
    const lock = await acquireProcessLock(platform, path);
    expect(JSON.parse(readFileSync(`${path}.holder`, "utf8"))).toMatchObject({ pid: process.pid });
    await (lock.ok ? lock.value.release() : undefined);
    expect(() => readFileSync(`${path}.holder`)).toThrow(/ENOENT/);
  });
});
