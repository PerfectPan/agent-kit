import { isFileLockHeld } from "../services/file-lock.js";
import type { ProcessLockPlatform } from "../ports.js";
import { isSqliteLockHeld } from "../services/sqlite-lock.js";

/**
 * Whether another process, or an acquisition in this one, holds the process lock on `path`, checked without taking
 * it: the check writes nothing (no `<path>.holder`, and a missing lock file stays missing and reads as free). The
 * answer may be stale by the time it arrives, so it can choose between handing work to the holder and starting one,
 * but it does not replace acquiring. The check never waits, so `signal` is consulted once, before it starts: an
 * aborted signal rejects with `signal.reason` without touching the lock file.
 *
 * With `platform.sqlite` it makes one attempt at a shared lock on the database, with no busy timeout and no retries,
 * and never reads the process identity; checks running at once do not see each other as holders. The first attempt of
 * an `acquireProcessLock` running at the same moment still gets a free lock; the later retries of `wait: true` can
 * find it busy while a check reads it, and get it one backoff later. Without SQLite it reads the lock file and judges
 * its holder as `acquireProcessLock` does, which reads the process identity, and leaves a dead holder's file for the
 * next acquisition to reclaim.
 */
export async function isProcessLockHeld(
  platform: ProcessLockPlatform,
  path: string,
  options: { readonly signal?: AbortSignal } = {}
): Promise<boolean> {
  options.signal?.throwIfAborted();
  const { sqlite } = platform;
  if (sqlite === undefined) {
    return isFileLockHeld(platform, path);
  }
  // Nothing holds a lock on a missing file. It is looked up before the read-only open, which never creates it: a failed
  // open does not show that the file is missing, because an acquisition may create it right after.
  const exists = async () => (await platform.fs.stat(path, { followSymlinks: true })) !== undefined;
  if (!(await exists())) {
    return false;
  }
  try {
    return isSqliteLockHeld(sqlite, path);
  } catch (error) {
    // Removed after the lookup.
    if (!(await exists())) {
      return false;
    }
    throw error;
  }
}
