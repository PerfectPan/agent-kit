import type { Platform, PlatformSqlite, SqliteDatabase } from "@rivus/agent-kit-platform";
import { PlatformService } from "@rivus/agent-kit-platform/effect";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as z from "zod/mini";

import { LedgerLock, type LedgerLockFailure, type LedgerLockShape, type LedgerScope } from "../../application/ports.js";
import type { LedgerBusy } from "../../domain/ledger/index.js";
import { readText } from "../services/read-text.js";
import { harnessStateDir } from "../services/state-dir.js";

type LockPlatform = Pick<Platform, "env" | "home" | "fs" | "process" | "clock" | "sqlite">;

// The lock is the same mechanism as the collab package's process lock; harness keeps its own copy because it cannot
// depend on collab (plan 3.9). Keep both covered by the same race tests.

/**
 * Two processes that try at once each take a shared lock on the way to the exclusive one; without a busy timeout both
 * give up and neither holds the lock. A short timeout lets SQLite settle that race while a real holder still answers
 * busy quickly. It blocks the thread, so only the first attempt of an acquisition uses it.
 */
const SETTLE_MS = 10;
const SETTLE_RETRIES = 4;
/** The first pause of a waiting acquisition; later ones double up to 16 times it, with jitter. */
const RETRY_MS = 20;

/** SQLITE_BUSY and SQLITE_LOCKED, the primary codes of their extended codes: another connection holds the lock. */
const BUSY_CODES = new Set([5, 6]);

const busyErrcode = z.number().check(z.custom((errcode: number) => BUSY_CODES.has(errcode & 0xff)));
const SqliteBusy = z.union([
  z.looseObject({ errcode: busyErrcode }),
  z.looseObject({ message: z.literal("database is locked") })
]);

function isSqliteBusy(error: unknown): boolean {
  return SqliteBusy.safeParse(error).success;
}

/**
 * Takes an exclusive lock on the SQLite database at `path`, creating the file, or returns `undefined` when another
 * connection holds it. The lock is an fcntl lock: it lasts until `ROLLBACK` and `close`, and the kernel drops it when
 * the process exits or crashes, so nothing is ever reclaimed. With the journal in memory, a holder killed inside its
 * transaction leaves no hot journal that would make every contender report busy at once (node:sqlite refuses
 * `journal_mode = OFF`).
 */
function trySqliteLock(sqlite: PlatformSqlite, path: string, busyTimeoutMs: number): SqliteDatabase | undefined {
  const db = sqlite.open(path);
  try {
    db.exec(`PRAGMA busy_timeout = ${busyTimeoutMs}`);
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

function unlockSqlite(db: SqliteDatabase): void {
  try {
    db.exec("ROLLBACK");
  } finally {
    db.close();
  }
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Who takes the lock, for the holder file; a platform that cannot identify the process still records the time. */
function holderRecord(platform: LockPlatform): string {
  let identity: object = {};
  try {
    const { host, pid, startTime } = platform.process.self;
    identity = { host, pid, startTime };
  } catch {
    // Not every platform can identify processes; the record is for diagnostics only.
  }
  return `${JSON.stringify({ ...identity, acquiredAt: new Date(platform.clock.now()).toISOString() })}\n`;
}

const Busy = Symbol("busy");

function makeLock(platform: LockPlatform): LedgerLockShape {
  const root = harnessStateDir(platform);
  const lockPath = (scope: LedgerScope) => `${root}/${scope.key}.lock.db`;
  const holderPath = (scope: LedgerScope) => `${root}/${scope.key}.lock.holder`;
  const lockFailure = (scope: LedgerScope, message: string, cause: unknown): LedgerLockFailure => ({
    _tag: "LedgerLockFailure",
    scope: scope.key,
    message,
    cause
  });

  const holder = (scope: LedgerScope) =>
    Effect.promise(() => readText(platform, holderPath(scope)).catch(() => undefined)).pipe(
      Effect.map((text) => text?.trim() || undefined)
    );

  /**
   * One attempt. Acquiring and registering the release are one uninterruptible step, so the lock cannot be taken
   * without a finalizer in the caller's Scope; a busy lock fails the attempt and registers nothing.
   */
  const attempt = (sqlite: PlatformSqlite, scope: LedgerScope, first: boolean) =>
    Effect.acquireRelease(
      Effect.tryPromise({
        try: async () => {
          const record = holderRecord(platform);
          await platform.fs.mkdir(root);
          const busyTimeoutMs = first ? SETTLE_MS : 0;
          let db = trySqliteLock(sqlite, lockPath(scope), busyTimeoutMs);
          for (let retry = 0; db === undefined && first && retry < SETTLE_RETRIES; retry += 1) {
            await delay(5 + Math.random() * 20);
            db = trySqliteLock(sqlite, lockPath(scope), busyTimeoutMs);
          }
          if (db === undefined) {
            return Busy;
          }
          try {
            await platform.fs.writeAtomic(holderPath(scope), record);
          } catch (cause) {
            unlockSqlite(db);
            throw cause;
          }
          return db;
        },
        catch: (cause) => lockFailure(scope, `cannot lock ${lockPath(scope)}`, cause)
      }).pipe(Effect.flatMap((db) => (db === Busy ? Effect.fail(Busy) : Effect.succeed(db)))),
      (db) =>
        Effect.promise(async () => {
          // The holder file goes while the lock is still held, so it never removes a successor's record.
          try {
            await platform.fs.remove(holderPath(scope));
          } catch {
            // Only diagnostics are lost.
          } finally {
            unlockSqlite(db);
          }
        })
    );

  const acquire: LedgerLockShape["acquire"] = (scope, options) =>
    Effect.gen(function* () {
      const { sqlite } = platform;
      if (sqlite === undefined) {
        return yield* Effect.fail({
          _tag: "LedgerLockUnavailable" as const,
          scope: scope.key,
          message: "the platform has no SQLite, and no other LedgerLock was provided"
        });
      }
      const started = platform.clock.monotonic();
      for (let turn = 0; ; turn += 1) {
        const taken = yield* attempt(sqlite, scope, turn === 0).pipe(
          Effect.as(true),
          Effect.catchIf(
            (failure): failure is typeof Busy => failure === Busy,
            () => Effect.succeed(false)
          )
        );
        if (taken) {
          return;
        }
        if (platform.clock.monotonic() - started >= options.waitMs) {
          const recorded = yield* holder(scope);
          const busy: LedgerBusy =
            recorded === undefined
              ? { _tag: "LedgerBusy", scope: scope.key }
              : { _tag: "LedgerBusy", scope: scope.key, holder: recorded };
          return yield* Effect.fail(busy);
        }
        // Waiting happens here, between attempts, where interruption is safe.
        yield* Effect.sleep(Math.min(RETRY_MS * 2 ** turn, RETRY_MS * 16) * (0.75 + Math.random() * 0.5));
      }
    });

  return { acquire, holder };
}

/**
 * The LedgerLock as an exclusive SQLite database per scope, `<state>/agent-kit/harness/<scope>.lock.db`, held with
 * `locking_mode=EXCLUSIVE` and `BEGIN EXCLUSIVE` until the Scope closes. The kernel releases it when the holder exits
 * or crashes, so the next process takes it at once and probes the pending operations. The holder writes its identity
 * to `<scope>.lock.holder`, which only diagnostics read. Without `platform.sqlite`, `acquire` fails with
 * `LedgerLockUnavailable`. Local directories only: fcntl locks are unreliable on NFS.
 */
export const SqliteLedgerLockLive: Layer.Layer<LedgerLock, never, PlatformService> = Layer.effect(
  LedgerLock,
  Effect.gen(function* () {
    return makeLock(yield* PlatformService);
  })
);
