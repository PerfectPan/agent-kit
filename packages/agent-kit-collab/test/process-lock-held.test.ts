import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vite-plus/test";

import type { Platform, PlatformSqlite } from "@rivus/agent-kit/platform";

import { acquireProcessLock, isProcessLockHeld } from "../src/process-lock/public.js";
import { removeTempDirs, tempDir, testPlatform } from "./support/platform.js";
import { startWorker, stopWorkers } from "./support/workers.js";

afterEach(async () => {
  await stopWorkers();
  removeTempDirs();
});

type Mechanism = "sqlite" | "file";

function refuse(name: string): () => Promise<never> {
  return () => Promise.reject(new Error(`the check called fs.${name}`));
}

/**
 * The platform as a check may use it: every file write rejects, SQLite opens only read-only, and with SQLite reading
 * the process identity throws.
 */
function checking(platform: Platform, mechanism: Mechanism): Platform {
  const { sqlite } = platform;
  const noIdentity = Object.create(platform.process, {
    self: {
      get(): never {
        throw new Error("the check read the process identity");
      }
    },
    identify: {
      value(): never {
        throw new Error("the check read the process identity");
      }
    }
  }) as Platform["process"];
  return {
    ...platform,
    fs: {
      ...platform.fs,
      writeAtomic: refuse("writeAtomic"),
      createExclusive: refuse("createExclusive"),
      mkdir: refuse("mkdir"),
      rename: refuse("rename"),
      remove: refuse("remove")
    },
    process: mechanism === "sqlite" ? noIdentity : platform.process,
    sqlite: sqlite && {
      open(file, options) {
        if (options?.readonly !== true) {
          throw new Error("the check opened the database for writing");
        }
        return sqlite.open(file, options);
      }
    }
  };
}

/** Takes and releases the lock once; with SQLite that leaves the database file behind, as a real holder would. */
async function usedLock(platform: Platform): Promise<string> {
  const path = join(tempDir(), "daemon.lock");
  const lock = await acquireProcessLock(platform, path);
  await (lock.ok ? lock.value.release() : undefined);
  return path;
}

describe.each(["sqlite", "file"] as const)("isProcessLockHeld with %s", (mechanism) => {
  const platform = testPlatform({ sqlite: mechanism === "sqlite" });

  it("S68: reports a lock another process holds, which keeps it, and reports it free once the holder is killed", async () => {
    const dir = tempDir();
    const path = join(dir, "daemon.lock");
    const holder = startWorker("process-lock-worker", [path, mechanism, "hold"]);
    await holder.next("acquired");
    const record = mechanism === "sqlite" ? `${path}.holder` : path;
    const recorded = readFileSync(record, "utf8");

    expect(await isProcessLockHeld(checking(platform, mechanism), path)).toBe(true);
    const refused = startWorker("process-lock-worker", [path, mechanism, "hold"]);
    expect(await refused.next("held")).toMatchObject({ holderPid: holder.pid });

    holder.signal("SIGKILL");
    await holder.exited;
    const files = readdirSync(dir).toSorted();
    expect(await isProcessLockHeld(checking(platform, mechanism), path)).toBe(false);
    // The dead holder's record stays as it was: the check reclaims nothing.
    expect(readdirSync(dir).toSorted()).toEqual(files);
    expect(readFileSync(record, "utf8")).toBe(recorded);
    const lock = await acquireProcessLock(platform, path);
    expect(lock.ok).toBe(true);
    await (lock.ok ? lock.value.release() : undefined);
  });

  it("reports a free lock free without taking it, so another process acquires it next", async () => {
    const path = await usedLock(platform);
    expect(await isProcessLockHeld(checking(platform, mechanism), path)).toBe(false);
    const next = startWorker("process-lock-worker", [path, mechanism, "hold"]);
    expect(await next.next("acquired")).toMatchObject({ pid: next.pid });
  });

  it("reports a missing lock file free and does not create it", async () => {
    const dir = tempDir();
    // The unrestricted platform: a check that opened the database for writing would create the file here.
    expect(await isProcessLockHeld(platform, join(dir, "daemon.lock"))).toBe(false);
    expect(await isProcessLockHeld(platform, join(dir, "absent", "daemon.lock"))).toBe(false);
    expect(readdirSync(dir)).toEqual([]);
    expect(await isProcessLockHeld(checking(platform, mechanism), join(dir, "daemon.lock"))).toBe(false);
  });

  it("reports an acquisition in this process as held, and checking does not release it", async () => {
    const path = join(tempDir(), "daemon.lock");
    const lock = await acquireProcessLock(platform, path);
    for (let check = 0; check < 3; check += 1) {
      expect(await isProcessLockHeld(checking(platform, mechanism), path)).toBe(true);
    }
    // Closing the check's own handle on the file must not drop this process's lock on it.
    const other = startWorker("process-lock-worker", [path, mechanism, "hold"]);
    expect(await other.next("held")).toMatchObject({ holderPid: process.pid });
    await (lock.ok ? lock.value.release() : undefined);
    expect(await isProcessLockHeld(checking(platform, mechanism), path)).toBe(false);
  });

  it("S68: rejects with an aborted signal's reason without touching the lock file", async () => {
    const reason = new Error("stop");
    const refuse = (): never => {
      throw new Error("the check touched the lock file");
    };
    const untouchable = Object.defineProperties({ ...platform }, { fs: { get: refuse }, sqlite: { get: refuse } });
    const path = join(tempDir(), "daemon.lock");
    await expect(isProcessLockHeld(untouchable, path, { signal: AbortSignal.abort(reason) })).rejects.toBe(reason);
  });

  it("S68: lets processes that check at once, with no holder, all find the lock free", async () => {
    const path = await usedLock(platform);
    const checkers = Array.from({ length: 6 }, () =>
      startWorker("process-lock-check-worker", [path, mechanism, "burst", "200"])
    );
    await Promise.all(checkers.map((checker) => checker.next("ready")));
    for (const checker of checkers) {
      checker.send("go");
    }
    const results = await Promise.all(checkers.map((checker) => checker.next("checked")));
    expect(results.map((result) => result.held)).toEqual(checkers.map(() => 0));
  });

  it("S68: never makes an acquisition miss the free lock while other processes keep checking it", async () => {
    const path = join(tempDir(), "daemon.lock");
    const checkers = Array.from({ length: 4 }, () =>
      startWorker("process-lock-check-worker", [path, mechanism, "loop"])
    );
    await Promise.all(checkers.map((checker) => checker.next("checking")));
    for (let round = 0; round < 50; round += 1) {
      const lock = await acquireProcessLock(platform, path);
      expect(lock.ok).toBe(true);
      await (lock.ok ? lock.value.release() : undefined);
    }
    for (const checker of checkers) {
      checker.send("stop");
    }
    const results = await Promise.all(checkers.map((checker) => checker.next("checked")));
    // Every checker kept checking throughout the acquisitions.
    for (const result of results) {
      expect(result.count).toBeGreaterThan(50);
    }
  });
});

describe("isProcessLockHeld with SQLite", () => {
  const platform = testPlatform();

  it("makes one attempt without waiting, even when the driver waits for locks by default", async () => {
    const sqlite = platform.sqlite as PlatformSqlite;
    const opens: unknown[] = [];
    const patient: Platform = {
      ...platform,
      sqlite: {
        open(file, options) {
          opens.push(options);
          const db = sqlite.open(file, options);
          db.exec("PRAGMA busy_timeout = 5000");
          return db;
        }
      }
    };
    const path = join(tempDir(), "daemon.lock");
    const holder = startWorker("process-lock-worker", [path, "sqlite", "hold"]);
    await holder.next("acquired");
    const started = performance.now();
    expect(await isProcessLockHeld(checking(patient, "sqlite"), path)).toBe(true);
    expect(performance.now() - started).toBeLessThan(1000);
    expect(opens).toEqual([{ readonly: true }]);
  });

  it("finds the lock free while another process holds the shared lock a check takes", async () => {
    const path = await usedLock(platform);
    const sharing = startWorker("process-lock-check-worker", [path, "sqlite", "share"]);
    await sharing.next("sharing");
    expect(await isProcessLockHeld(checking(platform, "sqlite"), path)).toBe(false);
  });
});

describe("isProcessLockHeld with a lock file", () => {
  const platform = testPlatform({ sqlite: false });

  it("judges the holder as an acquisition would, and reclaims nothing", async () => {
    const dir = tempDir();
    const unstamped = join(dir, "unstamped.lock");
    writeFileSync(unstamped, "");
    expect(await isProcessLockHeld(checking(platform, "file"), unstamped)).toBe(true);

    const reused = join(dir, "reused.lock");
    const stamp = JSON.stringify({
      ...platform.process.self,
      startTime: platform.process.self.startTime - 1,
      acquiredAt: 0,
      nonce: "old"
    });
    writeFileSync(reused, stamp);
    expect(await isProcessLockHeld(checking(platform, "file"), reused)).toBe(false);
    expect(readFileSync(reused, "utf8")).toBe(stamp);
  });
});
