import { err, ok, type Result } from "@rivus/agent-kit/catalog";
import type { FileStat } from "@rivus/agent-kit/platform";

import { tryFileLock } from "../services/file-lock.js";
import { sameFileIdentity } from "../services/file-identity.js";
import {
  holderOf,
  newStamp,
  ownIdentity,
  type ProcessIdentity,
  type ProcessLockHolder,
  readStamp
} from "../services/holder.js";
import type { ProcessLockPlatform } from "../ports.js";
import { SETTLE_MS, trySqliteLock, unlockSqlite } from "../services/sqlite-lock.js";
import { takeTurn } from "../services/turns.js";

export interface ProcessLockOptions {
  /**
   * Wait while another process holds the lock, or another acquisition in this one holds or is attempting it, instead
   * of returning `ProcessLockHeld` at once.
   */
  readonly wait?: boolean;
  /** How often a call waiting for another process tries again, in milliseconds; 50 by default. */
  readonly retryMs?: number;
  /** Aborting stops waiting and rejects with `signal.reason`; a lock taken after the abort is released first. */
  readonly signal?: AbortSignal;
  /**
   * Removes the lock file when the lock is released, for a caller that takes one lock per item and would otherwise
   * leave one file per item behind. With SQLite, the release removes `<path>` (and `<path>.holder`) while the lock is
   * still held, then unlocks; the acquisition verifies that the file it locked is still the one at `path`, by the
   * device, inode and birth time it read before opening, and retries when it is not, so a waiter that locked an
   * unlinked inode never holds the lock while its successor holds the file at `path`. A filesystem that reports no
   * birth time yields no identity to compare, so the verification never passes and the lock is not taken (a waiting
   * call keeps trying). Without SQLite the lock file is always removed on release, so the setting changes nothing
   * there.
   */
  readonly removeOnRelease?: boolean;
}

/** A held process lock. Releasing it is the caller's job; the lock also ends when the process exits. */
export interface ProcessLock {
  readonly path: string;
  /** `sqlite` when the platform has SQLite; `file` is the weaker fallback (see `acquireProcessLock`). */
  readonly mechanism: "sqlite" | "file";
  /**
   * Who took the lock, as recorded for diagnostics. `undefined` only with `sqlite`, when this process could not read its
   * own identity (see `acquireProcessLock`).
   */
  readonly holder: ProcessLockHolder | undefined;
  /** Releases the lock; later calls do nothing. */
  release(): Promise<void>;
}

/** Another process holds the lock, or another acquisition in this one holds or is attempting it. */
export interface ProcessLockHeld {
  readonly _tag: "ProcessLockHeld";
  readonly path: string;
  /**
   * What the holder recorded for diagnostics; it may be stale, and is absent when nothing readable was recorded, as when
   * the holder took a SQLite lock without its identity.
   */
  readonly holder: ProcessLockHolder | undefined;
}

/** Retries of a waiting caller double from `retryMs` up to 16 times it, with jitter so that waiters drift apart. */
export function backoffMs(retryMs: number, attempt: number): number {
  return Math.min(retryMs * 2 ** attempt, retryMs * 16) * (0.75 + Math.random() * 0.5);
}

const SETTLE_RETRIES = 4;

/** How many times one attempt re-reads the baseline and re-locks after a failed verification of the file it locked. */
const VERIFICATION_RETRIES = 4;

function once(release: () => Promise<void>): () => Promise<void> {
  let released: Promise<void> | undefined;
  return () => {
    released ??= release();
    return released;
  };
}

function holderFileOf(path: string): string {
  return `${path}.holder`;
}

/** What the holder recorded, as a refused attempt reads it: `<path>.holder` beside a SQLite lock, or the lock file. */
async function recordedHolder(platform: ProcessLockPlatform, path: string): Promise<ProcessLockHolder | undefined> {
  const recorded = await readStamp(platform, platform.sqlite === undefined ? path : holderFileOf(path));
  return recorded?.stamp && holderOf(recorded.stamp);
}

function delay(ms: number, signal: AbortSignal | undefined): Promise<void> {
  return new Promise((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout>;
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal?.reason);
    };
    timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * One attempt without waiting for a holder. The `first` attempt of an acquisition settles a race between processes
 * that start together (see `SETTLE_MS`); later attempts of a waiting caller do not block the thread at all. So the
 * caller reads `self` with `ownIdentity` once for all its attempts: the platform does not cache a failed read, and
 * each one runs `ps` or `sysctl` again on the thread. With `removeOnRelease`, the attempt verifies the file it locked
 * against the baseline it read before the open, and retries a failed verification a bounded number of times; a
 * missing path or a replacement at it retries, never passes. See `acquireProcessLock` for what an attempt does
 * without it.
 */
export async function tryProcessLock(
  platform: ProcessLockPlatform,
  path: string,
  options: {
    readonly first: boolean;
    readonly self: Result<ProcessIdentity, unknown>;
    readonly removeOnRelease?: boolean;
  }
): Promise<Result<ProcessLock, ProcessLockHeld>> {
  const { sqlite } = platform;
  const { self } = options;
  if (sqlite === undefined) {
    // Before anything is created: a throw after locking would leave the lock held for the life of the process.
    if (!self.ok) {
      throw self.error;
    }
    const attempt = await tryFileLock(platform, path, newStamp(platform, self.value));
    if (!attempt.acquired) {
      return err({ _tag: "ProcessLockHeld", path, holder: attempt.stamp && holderOf(attempt.stamp) });
    }
    return ok({ path, mechanism: "file", holder: holderOf(attempt.stamp), release: once(attempt.release) });
  }
  // The error is dropped: the lock needs nothing from it, and reading `process.self` again shows it.
  const stamp = self.ok ? newStamp(platform, self.value) : undefined;
  const holderFile = holderFileOf(path);
  const busyTimeoutMs = options.first ? SETTLE_MS : 0;
  const verify = options.removeOnRelease === true;
  for (let attempt = 0; ; attempt += 1) {
    // The baseline is read before the open it is checked against, so the successor's file never agrees with it: a
    // baseline taken after the open could see the newcomer's file while the busy wait lets the holder unlink the
    // file this call went on to lock, and the two readings would agree with two holders.
    let baseline: FileStat | undefined;
    if (verify) {
      baseline = await platform.fs.stat(path);
    }
    let db = trySqliteLock(sqlite, path, busyTimeoutMs);
    // Processes that try at the same moment can all lose to each other's shared locks, though none holds the lock.
    // A few retries at random short intervals separate them; a real holder is still there after the last one.
    for (let retry = 0; db === undefined && options.first && retry < SETTLE_RETRIES; retry += 1) {
      await delay(5 + Math.random() * 20, undefined);
      // A fresh baseline before every open: the file may have been replaced while this call waited to retry.
      if (verify) {
        baseline = await platform.fs.stat(path);
      }
      db = trySqliteLock(sqlite, path, busyTimeoutMs);
    }
    if (db === undefined) {
      return err({ _tag: "ProcessLockHeld", path, holder: await recordedHolder(platform, path) });
    }
    if (verify && !sameFileIdentity(baseline, await platform.fs.stat(path))) {
      // The locked file is no longer the one at the path: a waiter locked an unlinked inode, or the path was
      // replaced, or the path or the identity went missing. Unlock only, and never the normal release, which would
      // remove the lock path that now belongs to the successor or overwrite its holder file.
      unlockSqlite(db);
      if (attempt >= VERIFICATION_RETRIES) {
        return err({ _tag: "ProcessLockHeld", path, holder: await recordedHolder(platform, path) });
      }
      continue;
    }
    try {
      // Removed rather than left: refused attempts would name the earlier holder that died without releasing.
      await (stamp === undefined
        ? platform.fs.remove(holderFile)
        : platform.fs.writeAtomic(holderFile, JSON.stringify(stamp)));
    } catch (error) {
      unlockSqlite(db);
      throw error;
    }
    const release = async () => {
      // The holder file and, with `removeOnRelease`, the lock path itself go while the lock is still held, so the
      // release never removes a successor's record and never reuses the path behind a waiter's back; then the lock
      // ends.
      try {
        await platform.fs.remove(holderFile);
        if (verify) {
          await platform.fs.remove(path);
        }
      } finally {
        unlockSqlite(db);
      }
    };
    return ok({ path, mechanism: "sqlite", holder: stamp && holderOf(stamp), release: once(release) });
  }
}

/**
 * A single-instance lock on `path`, which must be in an existing local directory (not NFS). With `platform.sqlite`,
 * `path` is a SQLite database held with `locking_mode=EXCLUSIVE`: the kernel releases it when the process exits or
 * crashes, at once, and nothing is ever reclaimed. The holder's identity goes into `<path>.holder` for diagnostics
 * only, so a process that cannot read its own identity (`platform.process.self` throws: always on win32, which is not
 * supported, and on darwin in a sandbox that denies running `ps` or `sysctl`) still takes the lock: its `holder` is
 * `undefined`, and instead of writing `<path>.holder` it removes one that a dead holder left. Without SQLite, `path`
 * is a lock file that holds the identity itself; a lock file whose holder died is reclaimed on the next attempt, which
 * needs the holder on this host (see `tryFileLock` for the remaining gaps). The lock file cannot go without the
 * identity: the call rejects with the error reading it, and takes nothing.
 *
 * With `removeOnRelease` the release also removes the lock file itself, so a caller that takes one lock per item does
 * not leave one file per item behind; see `ProcessLockOptions` for how the acquisition keeps the removal from breaking
 * mutual exclusion.
 *
 * Acquisitions of one lock in this process take turns in memory (see `takeTurn`): while one holds the lock or is
 * attempting it, the next waits for it to release the lock or give up, then makes its own attempt, so none of them
 * blocks the thread in a SQLite busy wait on a holder in this process. Without `wait`, a call that finds the turn taken
 * resolves to `ProcessLockHeld` at once, without attempting, with the holder read from the lock's record.
 *
 * Supports darwin and linux.
 */
export async function acquireProcessLock(
  platform: ProcessLockPlatform,
  path: string,
  options: ProcessLockOptions = {}
): Promise<Result<ProcessLock, ProcessLockHeld>> {
  const { signal, wait = false, retryMs = 50 } = options;
  signal?.throwIfAborted();
  const endTurn = await takeTurn(platform, path, { wait, signal });
  if (endTurn === undefined) {
    return err({ _tag: "ProcessLockHeld", path, holder: await recordedHolder(platform, path) });
  }
  let held = false;
  try {
    const self = ownIdentity(platform);
    for (let attempt = 0; ; attempt += 1) {
      signal?.throwIfAborted();
      const result = await tryProcessLock(platform, path, {
        first: attempt === 0,
        self,
        removeOnRelease: options.removeOnRelease
      });
      if (result.ok) {
        if (signal?.aborted === true) {
          await result.value.release();
          signal.throwIfAborted();
        }
        held = true;
        const lock = result.value;
        const release = async () => {
          try {
            await lock.release();
          } finally {
            endTurn();
          }
        };
        return ok({ ...lock, release: once(release) });
      }
      if (!wait) {
        return result;
      }
      await delay(backoffMs(retryMs, attempt), signal);
    }
  } finally {
    // The turn ends with the call unless it returns the lock, whose release ends it.
    if (!held) {
      endTurn();
    }
  }
}
