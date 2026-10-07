import type { SqliteDatabase, SqliteStatement } from "@rivus/agent-kit/platform";
import { PlatformService } from "@rivus/agent-kit/platform/effect";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schedule from "effect/Schedule";

import { isSqliteBusy } from "../../process-lock/application/sqlite-lock.js";
import type { LeaseSnapshot } from "../domain/lease/index.js";
import { LeaseStore, type LeaseStoreFailure } from "../application/ports.js";
import { storeFailure } from "../application/store-failure.js";
import { keyFileName } from "./key-file-name.js";
import { decodeHolder, decodeSnapshot, encodeHolder } from "./lease-record-codec.js";
import { holdProcessLock } from "./process-fence.js";

export interface SqliteLeaseStoreOptions {
  /**
   * The database file, in an existing local directory. The per-key fence locks of `runFenced` live next to it as
   * `<path>.<key>.fence` (plus a `.holder` file each), so give the store a directory of its own or a distinct name.
   */
  readonly path: string;
}

const SCHEMA_VERSION = 1;
/** Long enough for another writer's single-row transaction; longer waits block the event loop, so retry instead. */
const BUSY_TIMEOUT_MS = 50;
const BUSY_RETRIES = 100;
const BUSY_RETRY_MS = 5;

interface Statements {
  readonly select: SqliteStatement;
  readonly selectRevision: SqliteStatement;
  readonly upsert: SqliteStatement;
}

/**
 * The lease store for one machine: one row per key in a SQLite database. `compareAndSet` runs in a
 * `BEGIN IMMEDIATE` transaction, which takes SQLite's write lock (an fcntl lock) before reading the revision, so
 * processes sharing the file compare and write atomically. The lock is released when its process exits, so neither a
 * crashed writer nor a reused pid can leave the store stuck. Fails to build with `unavailable` when the platform has
 * no SQLite, and with `unsupported-schema` for a database written by a newer version.
 */
export function sqliteLeaseStore(
  options: SqliteLeaseStoreOptions
): Layer.Layer<LeaseStore, LeaseStoreFailure, PlatformService> {
  const { path } = options;
  return Layer.effect(
    LeaseStore,
    Effect.gen(function* () {
      const platform = yield* PlatformService;
      const { sqlite } = platform;
      if (sqlite === undefined) {
        return yield* Effect.fail(storeFailure("", "unavailable", "the platform has no SQLite"));
      }
      const db = yield* Effect.acquireRelease(
        sqliteTry("", `cannot open ${path}`, () => sqlite.open(path)),
        (opened) => Effect.sync(() => opened.close())
      );
      yield* retryBusy(sqliteTry("", `cannot prepare ${path}`, () => migrate(db)));
      const statements: Statements = {
        select: db.prepare(
          "SELECT key, generation, revision, holder, holder_id, renewed_at FROM lease_record WHERE key = ?"
        ),
        selectRevision: db.prepare("SELECT revision FROM lease_record WHERE key = ?"),
        upsert: db.prepare(
          `INSERT INTO lease_record (key, generation, revision, holder, holder_id, renewed_at) VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT (key) DO UPDATE SET generation = excluded.generation, revision = excluded.revision,
             holder = excluded.holder, holder_id = excluded.holder_id, renewed_at = excluded.renewed_at`
        )
      };
      return {
        read: (key) =>
          retryBusy(sqliteTry(key, `cannot read ${path}`, () => statements.select.get(key))).pipe(
            Effect.flatMap((row) => decodeRow(key, row))
          ),
        compareAndSet: (key, expected, next) =>
          retryBusy(sqliteTry(key, `cannot write ${path}`, () => compareAndSet(db, statements, expected, next))),
        fence: (key) =>
          keyFileName(key).pipe(Effect.flatMap((name) => holdProcessLock(platform, key, `${path}.${name}.fence`)))
      };
    })
  );
}

function migrate(db: SqliteDatabase): void {
  db.exec(`PRAGMA busy_timeout = ${BUSY_TIMEOUT_MS}`);
  // WAL lets reads run while another process writes. Nothing depends on it: where the file system refuses WAL, the
  // database stays in rollback mode, and a read that meets a writer reports busy and is retried like a write.
  db.exec("PRAGMA journal_mode = WAL");
  transaction(db, () => {
    const version = Number(db.prepare("PRAGMA user_version").get()?.user_version ?? 0);
    if (version === 0) {
      db.exec(`CREATE TABLE IF NOT EXISTS lease_record (
        key TEXT PRIMARY KEY,
        generation INTEGER NOT NULL,
        revision INTEGER NOT NULL,
        holder TEXT,
        holder_id TEXT,
        renewed_at INTEGER NOT NULL
      ) STRICT`);
      db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
    } else if (version !== SCHEMA_VERSION) {
      throw new UnsupportedSchema(
        `the lease database has schema version ${version}; this version reads ${SCHEMA_VERSION}`
      );
    }
  });
}

function compareAndSet(db: SqliteDatabase, statements: Statements, expected: number | undefined, next: LeaseSnapshot) {
  return transaction(db, () => {
    const stored = statements.selectRevision.get(next.key)?.revision;
    if ((stored === undefined ? undefined : Number(stored)) !== expected) {
      return false;
    }
    statements.upsert.run(
      next.key,
      next.generation,
      next.revision,
      encodeHolder(next.holder),
      next.holderId,
      next.renewedAt
    );
    return true;
  });
}

/** Runs `body` in a `BEGIN IMMEDIATE` transaction, committing when it returns and rolling back when it throws. */
function transaction<T>(db: SqliteDatabase, body: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = body();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    // A failed COMMIT (busy, IO) can leave the transaction open, and the next BEGIN would fail on this connection.
    // SQLite may already have rolled back on its own; ROLLBACK then fails with "no transaction is active", which is
    // the state wanted, so only the original error is reported.
    try {
      db.exec("ROLLBACK");
    } catch {
      // Nothing left to roll back.
    }
    throw error;
  }
}

class UnsupportedSchema extends Error {}

function sqliteTry<T>(key: string, message: string, body: () => T): Effect.Effect<T, LeaseStoreFailure> {
  return Effect.try({
    try: body,
    catch: (cause) => {
      if (cause instanceof UnsupportedSchema) {
        return storeFailure(key, "unsupported-schema", cause.message);
      }
      return storeFailure(key, isSqliteBusy(cause) ? "busy" : "io", message, cause);
    }
  });
}

function retryBusy<T>(effect: Effect.Effect<T, LeaseStoreFailure>): Effect.Effect<T, LeaseStoreFailure> {
  return effect.pipe(
    Effect.retry({
      while: (failure) => failure.reason === "busy",
      times: BUSY_RETRIES,
      schedule: Schedule.spaced(BUSY_RETRY_MS)
    })
  );
}

function decodeRow(
  key: string,
  row: Record<string, unknown> | undefined
): Effect.Effect<LeaseSnapshot | undefined, LeaseStoreFailure> {
  if (row === undefined) {
    return Effect.succeed(undefined);
  }
  const holder = typeof row.holder === "string" || row.holder === null ? decodeHolder(row.holder) : undefined;
  const snapshot =
    holder === undefined
      ? undefined
      : decodeSnapshot({
          key: row.key,
          generation: row.generation,
          revision: row.revision,
          holder,
          holderId: row.holder_id,
          renewedAt: row.renewed_at
        });
  return snapshot === undefined
    ? Effect.fail(storeFailure(key, "invalid-record", `the stored record for ${key} has an unexpected shape`))
    : Effect.succeed(snapshot);
}
