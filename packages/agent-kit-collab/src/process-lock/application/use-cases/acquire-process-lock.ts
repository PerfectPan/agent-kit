import { err, ok, type Result } from "@rivus/agent-kit/catalog";

import { tryFileLock } from "../services/file-lock.js";
import {
  holderOf,
  holderOfSqlite,
  newStamp,
  type ProcessLockHolder,
  readSqliteStamp,
  sqliteStamp
} from "../services/holder.js";
import type { ProcessLockPlatform } from "../ports.js";
import { SETTLE_MS, trySqliteLock, unlockSqlite } from "../services/sqlite-lock.js";

export interface ProcessLockOptions {
  /** Keep trying while another process holds the lock, instead of returning `ProcessLockHeld` at once. */
  readonly wait?: boolean;
  /** How often a waiting call tries again, in milliseconds; 50 by default. */
  readonly retryMs?: number;
  /** Aborting stops waiting and rejects with `signal.reason`; a lock taken after the abort is released first. */
  readonly signal?: AbortSignal;
}

/** A held process lock. Releasing it is the caller's job; the lock also ends when the process exits. */
export interface ProcessLock {
  readonly path: string;
  /** `sqlite` when the platform has SQLite; `file` is the weaker fallback (see `acquireProcessLock`). */
  readonly mechanism: "sqlite" | "file";
  readonly holder: ProcessLockHolder;
  /** Releases the lock; later calls do nothing. */
  release(): Promise<void>;
}

/** Another process, or another acquisition in this one, holds the lock. */
export interface ProcessLockHeld {
  readonly _tag: "ProcessLockHeld";
  readonly path: string;
  /** What the holder recorded for diagnostics; it may be stale, and is absent when nothing readable was recorded. */
  readonly holder: ProcessLockHolder | undefined;
}

/** Retries of a waiting caller double from `retryMs` up to 16 times it, with jitter so that waiters drift apart. */
export function backoffMs(retryMs: number, attempt: number): number {
  return Math.min(retryMs * 2 ** attempt, retryMs * 16) * (0.75 + Math.random() * 0.5);
}

const SETTLE_RETRIES = 4;

function once(release: () => Promise<void>): () => Promise<void> {
  let released: Promise<void> | undefined;
  return () => {
    released ??= release();
    return released;
  };
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
 * that start together (see `SETTLE_MS`); later attempts of a waiting caller do not block the thread at all.
 */
export async function tryProcessLock(
  platform: ProcessLockPlatform,
  path: string,
  options: { readonly first: boolean }
): Promise<Result<ProcessLock, ProcessLockHeld>> {
  // The identity is read before anything is locked: reading it can throw (win32, a failing ps), and a lock taken
  // before that would stay held for the life of the process. SQLite records host and pid only, which does not spawn.
  const { sqlite } = platform;
  if (sqlite === undefined) {
    const stamp = newStamp(platform);
    const attempt = await tryFileLock(platform, path, stamp);
    if (!attempt.acquired) {
      return err({ _tag: "ProcessLockHeld", path, holder: attempt.stamp && holderOf(attempt.stamp) });
    }
    return ok({ path, mechanism: "file", holder: holderOf(attempt.stamp), release: once(attempt.release) });
  }
  const stamp = sqliteStamp(platform);
  const holderFile = `${path}.holder`;
  const busyTimeoutMs = options.first ? SETTLE_MS : 0;
  let db = trySqliteLock(sqlite, path, busyTimeoutMs);
  // Processes that try at the same moment can all lose to each other's shared locks, though none holds the lock.
  // A few retries at random short intervals separate them; a real holder is still there after the last one.
  for (let retry = 0; db === undefined && options.first && retry < SETTLE_RETRIES; retry += 1) {
    await delay(5 + Math.random() * 20, undefined);
    db = trySqliteLock(sqlite, path, busyTimeoutMs);
  }
  if (db === undefined) {
    const recorded = await readSqliteStamp(platform, holderFile);
    return err({ _tag: "ProcessLockHeld", path, holder: recorded?.stamp && holderOfSqlite(recorded.stamp) });
  }
  try {
    await platform.fs.writeAtomic(holderFile, JSON.stringify(stamp));
  } catch (error) {
    unlockSqlite(db);
    throw error;
  }
  const release = async () => {
    // The holder file goes while the lock is still held, so it never removes a successor's record.
    try {
      await platform.fs.remove(holderFile);
    } finally {
      unlockSqlite(db);
    }
  };
  return ok({ path, mechanism: "sqlite", holder: holderOfSqlite(stamp), release: once(release) });
}

/**
 * A single-instance lock on `path`, which must be in an existing local directory (not NFS). With `platform.sqlite`,
 * `path` is a SQLite database held with `locking_mode=EXCLUSIVE`: the kernel releases it when the process exits or
 * crashes, at once, and nothing is ever reclaimed. `<path>.holder` records host, pid and the time of acquisition for
 * diagnostics only, not the boot id or start time, so taking the lock spawns no process. A stamp from an older
 * version that still has those fields is read as it was written. Without SQLite, `path` is a lock file that holds
 * the full identity; a lock file whose holder died is
 * reclaimed on the next attempt, which needs the holder on this host (see `tryFileLock` for the remaining gaps).
 *
 * Supports darwin and linux, where the platform can identify processes.
 */
export async function acquireProcessLock(
  platform: ProcessLockPlatform,
  path: string,
  options: ProcessLockOptions = {}
): Promise<Result<ProcessLock, ProcessLockHeld>> {
  const { signal, wait = false, retryMs = 50 } = options;
  for (let attempt = 0; ; attempt += 1) {
    signal?.throwIfAborted();
    const result = await tryProcessLock(platform, path, { first: attempt === 0 });
    if (result.ok) {
      if (signal?.aborted === true) {
        await result.value.release();
        signal.throwIfAborted();
      }
      return result;
    }
    if (!wait) {
      return result;
    }
    await delay(backoffMs(retryMs, attempt), signal);
  }
}
