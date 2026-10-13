import { isFileLockHeld } from "../services/file-lock.js";
import type { ProcessLockPlatform } from "../ports.js";
import { isSqliteLockHeld } from "../services/sqlite-lock.js";

/**
 * Whether another process, or an acquisition in this one, holds the process lock on `path`, checked without taking
 * it: the check writes nothing (no `<path>.holder`, and a missing lock file stays missing and reads as free), and an
 * `acquireProcessLock` running at the same moment still gets a free lock. The answer may be stale by the time it
 * arrives, so it can choose between handing work to the holder and starting one, but it does not replace acquiring.
 *
 * With `platform.sqlite` it makes one attempt at a shared lock on the database, with no busy timeout and no retries,
 * and never reads the process identity; checks running at once do not see each other as holders. Without SQLite it
 * reads the lock file and judges its holder as `acquireProcessLock` does, which reads the process identity, and leaves
 * a dead holder's file for the next acquisition to reclaim.
 */
export async function isProcessLockHeld(platform: ProcessLockPlatform, path: string): Promise<boolean> {
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
