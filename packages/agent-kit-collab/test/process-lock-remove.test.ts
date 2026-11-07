import { unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vite-plus/test";

import type { FileStat, Platform } from "@rivus/agent-kit/platform";

import { sameFileIdentity } from "../src/process-lock/application/services/file-identity.js";
import type { SqliteDatabase } from "../src/process-lock/application/services/sqlite-lock.js";
import { trySqliteLock, unlockSqlite } from "../src/process-lock/application/services/sqlite-lock.js";
import { acquireProcessLock, isProcessLockHeld, type ProcessLockPlatform } from "../src/process-lock/public.js";
import { removeTempDirs, tempDir, testPlatform } from "./support/platform.js";

afterEach(() => {
  removeTempDirs();
});

/**
 * A platform whose one writable open performs, between the acquirer's open and its `BEGIN EXCLUSIVE`, what a releasing
 * holder and a newcomer do while the acquirer waits out its busy timeout: the holder unlinks the file it still locks,
 * the newcomer's file takes the path and the newcomer locks it, and then the holder releases, so the acquirer's lock
 * succeeds on the unlinked inode. The successor's database is locked for the whole acquisition and the test releases
 * it through `successor()` afterwards.
 */
function withSwapAttack(
  platform: Platform,
  path: string,
  fsPatch: (fs: Platform["fs"]) => Platform["fs"] = (fs) => fs
): {
  platform: ProcessLockPlatform;
  successor: () => SqliteDatabase;
  removals: string[];
  writes: string[];
} {
  const { sqlite } = platform;
  if (sqlite === undefined) {
    throw new Error("sqlite expected");
  }
  const holder = trySqliteLock(sqlite, path, 0);
  if (holder === undefined) {
    throw new Error("the holder lock was refused");
  }
  const open = sqlite.open.bind(sqlite);
  let successor: SqliteDatabase | undefined;
  const removals: string[] = [];
  const writes: string[] = [];
  const attacker: ProcessLockPlatform = {
    ...platform,
    fs: fsPatch({
      ...platform.fs,
      remove: async (removed) => {
        removals.push(removed);
        return platform.fs.remove(removed);
      },
      writeAtomic: async (written, data, options) => {
        writes.push(written);
        return platform.fs.writeAtomic(written, data, options);
      }
    }),
    sqlite: {
      open(file, options) {
        if (options?.readonly === true || successor !== undefined) {
          return open(file, options);
        }
        const db = open(file, options);
        unlinkSync(path);
        writeFileSync(path, "");
        successor = trySqliteLock(sqlite, path, 0);
        if (successor === undefined) {
          throw new Error("the newcomer lock was refused");
        }
        unlockSqlite(holder);
        return db;
      }
    }
  };
  return {
    platform: attacker,
    successor: () => {
      if (successor === undefined) {
        throw new Error("the attack did not run");
      }
      return successor;
    },
    removals,
    writes
  };
}

describe.each(["sqlite", "file"] as const)("acquireProcessLock removeOnRelease with %s", (mechanism) => {
  const platform = testPlatform({ sqlite: mechanism === "sqlite" });

  it("S?: removes the lock file and its holder file when released, and is free and retakes after", async () => {
    const path = join(tempDir(), "daemon.lock");
    const lock = await acquireProcessLock(platform, path, { removeOnRelease: true });
    if (!lock.ok) {
      throw new Error("not acquired");
    }
    expect(lock.value.mechanism).toBe(mechanism);
    await lock.value.release();
    expect(await platform.fs.stat(path)).toBeUndefined();
    expect(await platform.fs.stat(`${path}.holder`)).toBeUndefined();
    expect(await isProcessLockHeld(platform, path)).toBe(false);
    const again = await acquireProcessLock(platform, path, { removeOnRelease: true });
    expect(again.ok).toBe(true);
    await (again.ok ? again.value.release() : undefined);
    expect(await platform.fs.stat(path)).toBeUndefined();
  });
});

describe("acquireProcessLock removeOnRelease with sqlite", () => {
  const platform = testPlatform({ sqlite: true });

  it("S?: without the setting, release leaves the lock file, as before", async () => {
    const path = join(tempDir(), "daemon.lock");
    const lock = await acquireProcessLock(platform, path);
    if (!lock.ok) {
      throw new Error("not acquired");
    }
    await lock.value.release();
    expect(await platform.fs.stat(path)).toBeDefined();
    expect(await platform.fs.stat(`${path}.holder`)).toBeUndefined();
    expect(await isProcessLockHeld(platform, path)).toBe(false);
  });

  it("S?: retries a missing lock path instead of passing the verification, and then holds the file it created", async () => {
    const path = join(tempDir(), "daemon.lock");
    const stats: (FileStat | undefined)[] = [];
    const stat = platform.fs.stat.bind(platform.fs);
    const recorder: ProcessLockPlatform = {
      ...platform,
      fs: {
        ...platform.fs,
        stat: async (target, options) => {
          const observed = await stat(target, options);
          stats.push(observed);
          return observed;
        }
      }
    };
    const lock = await acquireProcessLock(recorder, path, { removeOnRelease: true });
    if (!lock.ok) {
      throw new Error("not acquired");
    }
    // The first baseline saw no file and the verification against it failed; the attempt retried, and the second
    // baseline and the post-lock reading agree on the file the acquirer created and locked.
    expect(stats).toHaveLength(4);
    expect(stats[0]).toBeUndefined();
    expect(sameFileIdentity(stats[1], stats[2])).toBe(true);
    expect(sameFileIdentity(stats[2], stats[3])).toBe(true);
    await lock.value.release();
    expect(await platform.fs.stat(path)).toBeUndefined();
  });

  it("S?: never holds the lock when the file it locked was unlinked and replaced: the successor keeps the path", async () => {
    const path = join(tempDir(), "daemon.lock");
    const { platform: attacker, successor, removals, writes } = withSwapAttack(platform, path);
    try {
      const result = await acquireProcessLock(attacker, path, { removeOnRelease: true });
      expect(result.ok).toBe(false);
      if (result.ok) {
        throw new Error("the acquirer holds a lock on an unlinked inode");
      }
      expect(result.error._tag).toBe("ProcessLockHeld");
      // The mismatch exit only unlocked: it removed nothing and wrote no holder file over the successor's.
      expect(removals).toEqual([]);
      expect(writes).toEqual([]);
      // The successor still holds the lock on the file at the path.
      expect(await isProcessLockHeld(platform, path)).toBe(true);
    } finally {
      unlockSqlite(successor());
    }
    expect(await isProcessLockHeld(platform, path)).toBe(false);
  });

  it("S?: refuses a successor whose file reuses the inode number but not the birth time", async () => {
    const path = join(tempDir(), "daemon.lock");
    const stat = platform.fs.stat.bind(platform.fs);
    let baseline: FileStat | undefined;
    const {
      platform: attacker,
      successor,
      removals,
      writes
    } = withSwapAttack(platform, path, (fs) => ({
      ...fs,
      stat: async (target, options) => {
        const observed = await stat(target, options);
        if (observed === undefined) {
          return undefined;
        }
        if (baseline === undefined) {
          baseline = observed;
          return observed;
        }
        // The successor's file reports the same device and inode number as the baseline and its own birth time: the
        // reuse that device and inode alone would mistake for the file the acquirer saw.
        const baseIdentity = baseline.identity;
        const identity = observed.identity;
        return baseIdentity === undefined || identity === undefined
          ? observed
          : {
              ...observed,
              identity: { dev: baseIdentity.dev, ino: baseIdentity.ino, birthtimeNs: identity.birthtimeNs }
            };
      }
    }));
    try {
      const result = await acquireProcessLock(attacker, path, { removeOnRelease: true });
      expect(result.ok).toBe(false);
      if (result.ok) {
        throw new Error("the acquirer holds a lock on an unlinked inode");
      }
      expect(removals).toEqual([]);
      expect(writes).toEqual([]);
      expect(await isProcessLockHeld(platform, path)).toBe(true);
    } finally {
      unlockSqlite(successor());
    }
    expect(await isProcessLockHeld(platform, path)).toBe(false);
  });
});
