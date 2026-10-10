import type { PlatformSqlite, SqliteDatabase } from "@rivus/agent-kit/platform";
import * as z from "zod/mini";

/**
 * Two processes that try at once each take a shared lock on the way to the exclusive one; with no busy timeout both
 * give up, and neither holds the lock. A short timeout lets SQLite settle that race (the loser backs off at once,
 * the winner waits for it) while a real holder still answers busy quickly. The wait blocks the thread, so only the
 * first attempt of an acquisition uses it; the retries of a waiting caller use none and back off instead.
 */
export const SETTLE_MS = 10;

/** SQLITE_BUSY and SQLITE_LOCKED, the primary codes of their extended codes: another connection holds the lock. */
const BUSY_CODES = new Set([5, 6]);

export function isSqliteBusy(error: unknown): boolean {
  // isSqliteBusy must sit above its caller trySqliteLock, and SqliteBusy may not move.
  // oxlint-disable-next-line no-use-before-define
  return SqliteBusy.safeParse(error).success;
}

/**
 * Takes an exclusive lock on the SQLite database at `path`, creating the file, or returns `undefined` when another
 * connection holds it. The lock is an fcntl lock on the file: it lasts until `ROLLBACK` and `close`, and the kernel
 * drops it when the process exits or crashes, so no holder can be left behind and nothing is ever reclaimed.
 */
export function trySqliteLock(sqlite: PlatformSqlite, path: string, busyTimeoutMs: number): SqliteDatabase | undefined {
  const db = sqlite.open(path);
  try {
    db.exec(`PRAGMA busy_timeout = ${busyTimeoutMs}`);
    // The database never holds data. With the journal in memory, a holder killed mid-transaction leaves no hot journal
    // that the next contenders would each have to roll back, which makes them all report busy at once. (Defensive
    // builds of SQLite, such as node:sqlite, refuse journal_mode = OFF.)
    db.exec("PRAGMA journal_mode = MEMORY");
    db.exec("PRAGMA locking_mode = EXCLUSIVE");
    db.exec("BEGIN EXCLUSIVE");
    return db;
  } catch (error) {
    db.close();
    if (isSqliteBusy(error)) {
      return undefined;
    }
    throw error;
  }
}

export function unlockSqlite(db: SqliteDatabase): void {
  try {
    db.exec("ROLLBACK");
  } finally {
    db.close();
  }
}

const SqliteBusy = z.union([
  z.looseObject({ errcode: z.number().check(z.custom((errcode: number) => BUSY_CODES.has(errcode & 0xff))) }),
  z.looseObject({ message: z.literal("database is locked") })
]);
