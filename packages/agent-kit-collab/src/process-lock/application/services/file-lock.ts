import { holderLiveness } from "../../../lease/domain/lease/index.js";
import { type HolderStamp, readStamp, type StampFile } from "./holder.js";
import type { ProcessLockPlatform } from "../ports.js";

/**
 * How long a lock file may stay empty or unreadable before it counts as abandoned. A holder writes its stamp right
 * after creating the file, so only a process that died in between leaves it empty. A holder stalled for longer than
 * this between the two steps loses its file to a reclaimer and may then overwrite the reclaimer's stamp with its own;
 * the read-back below catches the overwrite only when it lands before the reclaimer reads back.
 */
const UNSTAMPED_GRACE_MS = 30_000;

/** `.stale`, `.stale.stale`, …: each level serializes the reclaim of the level below. */
const MAX_RECLAIM_DEPTH = 3;

export type FileLockAttempt =
  | { readonly acquired: true; readonly stamp: HolderStamp; readonly release: () => Promise<void> }
  | { readonly acquired: false; readonly stamp: HolderStamp | undefined };

async function abandoned(platform: ProcessLockPlatform, path: string, observed: StampFile): Promise<boolean> {
  const { stamp } = observed;
  if (stamp === undefined) {
    const stat = await platform.fs.stat(path);
    return stat !== undefined && platform.clock.now() - stat.mtimeMs > UNSTAMPED_GRACE_MS;
  }
  const { self } = platform.process;
  return holderLiveness(stamp, self, platform.process.identify(stamp.pid)) === "dead";
}

/** Removes the abandoned lock file while holding `<path>.stale`; `false` when another reclaimer holds that. */
async function reclaim(
  platform: ProcessLockPlatform,
  path: string,
  observed: StampFile,
  stamp: HolderStamp,
  depth: number
): Promise<boolean> {
  // Mutual recursion: the guard is the lock file one level up, taken again through tryFileLock.
  // oxlint-disable-next-line no-use-before-define
  const guard = await tryFileLock(platform, `${path}.stale`, { ...stamp, nonce: crypto.randomUUID() }, depth + 1);
  if (!guard.acquired) {
    return false;
  }
  try {
    // Judged again under the guard: an empty file of a new holder has the same text as an abandoned one.
    const current = await readStamp(platform, path);
    if (current !== undefined && current.text === observed.text && (await abandoned(platform, path, current))) {
      await platform.fs.remove(path);
    }
    return true;
  } finally {
    await guard.release();
  }
}

async function releaseFileLock(platform: ProcessLockPlatform, path: string, nonce: string): Promise<void> {
  const current = await readStamp(platform, path);
  if (current?.stamp?.nonce === nonce) {
    await platform.fs.remove(path);
  }
}

/**
 * Tries once to take the lock file at `path`; it never waits for a live holder. The file holds the holder's stamp. A
 * file whose holder is dead (same host, and an earlier boot, no such pid or a reused pid) is reclaimed, as
 * npm/lockfile does with its `.STALE` lock: only the reclaimer that takes `<path>.stale` may remove it, and only after
 * reading the same dead stamp again, so two reclaimers cannot each remove the other's fresh lock.
 *
 * Weaker than the SQLite lock: a holder on another host is never judged dead, and neither is a dead holder's stamp
 * written before this host's name changed, so such a file stays until it is removed by hand; a stamp is written after
 * the file is created, a crash between the two leaves an empty file for `UNSTAMPED_GRACE_MS`, and a holder stalled
 * longer than that between the two can end up holding the lock together with its reclaimer.
 */
export async function tryFileLock(
  platform: ProcessLockPlatform,
  path: string,
  stamp: HolderStamp,
  depth = 0
): Promise<FileLockAttempt> {
  let reclaimed = false;
  // Each turn either takes the file, finds it held, or saw it vanish in between; a file that keeps vanishing counts
  // as held after a few turns.
  for (let turn = 0; turn < 8; turn += 1) {
    if (await platform.fs.createExclusive(path)) {
      try {
        await platform.fs.writeAtomic(path, JSON.stringify(stamp));
      } catch (error) {
        await platform.fs.remove(path);
        throw error;
      }
      // writeAtomic replaces the file, so a stalled holder's late stamp can land over this one; ours must be there.
      const written = await readStamp(platform, path);
      if (written?.stamp?.nonce !== stamp.nonce) {
        return { acquired: false, stamp: written?.stamp };
      }
      return { acquired: true, stamp, release: () => releaseFileLock(platform, path, stamp.nonce) };
    }
    const observed = await readStamp(platform, path);
    if (observed === undefined) {
      // The holder released between the two calls.
      continue;
    }
    if (reclaimed || depth >= MAX_RECLAIM_DEPTH || !(await abandoned(platform, path, observed))) {
      return { acquired: false, stamp: observed.stamp };
    }
    reclaimed = await reclaim(platform, path, observed, stamp, depth);
    if (!reclaimed) {
      return { acquired: false, stamp: observed.stamp };
    }
  }
  return { acquired: false, stamp: (await readStamp(platform, path))?.stamp };
}
