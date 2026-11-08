import { type CodingAgentId } from "@rivus/agent-kit-catalog/public";
import * as z from "zod/mini";

import { basenamePath } from "../../../lib/paths.js";
import { lenient } from "../../../lib/lenient.js";
import { rememberKey } from "../../../lib/remember-key.js";
import { decodeIsFinal } from "../../../domain/usage/services/quiet.js";
import { type ReadFailed } from "../../../domain/session/errors/session-read-error.js";
import { type UsageRecord } from "../../../domain/usage/value-objects/usage-record.js";
import { type SourcePointer } from "../../../domain/transcript/value-objects/source-pointer.js";
import { guardIo } from "../files/io-failure.js";
import { drain, usageStreamOf } from "./files.js";
import type {
  DecodeUsageOptions,
  UsageDecodeError,
  UsageDecodeFailure,
  UsagePlatform,
  UsageSource,
  UsageStream
} from "../../spi.js";

type SqliteDatabase = ReturnType<NonNullable<UsagePlatform["sqlite"]>["open"]>;
type SqliteValue = Parameters<ReturnType<SqliteDatabase["prepare"]>["all"]>[number];

/** Where a stored message comes from, besides its JSON. */
export interface SqliteMessageRow {
  /** The message id, which becomes the record's request id. */
  readonly id?: string;
  readonly sessionId?: string;
  readonly source: SourcePointer;
  /**
   * Set when the message cannot run any more: the store is complete. An assistant message without a completion time
   * then stopped unfinished and counts at its creation time, else at its completion time.
   */
  readonly settledAt?: number;
}

/** One row of an agent's `message` table, as the settlement rules read it. */
export interface SqliteTableRow {
  readonly id: string;
  /** The row's position in the table, which a record's source line keeps. */
  readonly row: number;
  /** When the row was last updated, which the pages of a continuing scan follow. */
  readonly updated: number;
  /** The row's `time_created` as a number; a final decode reports an unfinished message at it. */
  readonly created: number;
  readonly sessionId?: string;
  /** The row's `data` column; a message whose data is not JSON is skipped. */
  readonly data: string;
}

/** The usage of one stored message's JSON, which the provider's own rules read. */
export type SqliteMessageDecode = (value: unknown, row: SqliteMessageRow) => UsageRecord | "running" | undefined;

/** Where a decode of the database stopped, as plain JSON data for the cursor to carry. */
export interface SqliteSettlementState {
  /** The latest row read: when it was last updated, and its id. Later decodes read the rows changed after it. */
  updated: number;
  id: string;
  /** While the first read goes by row id: the last row id read. */
  row?: number;
  /** Assistant messages that were running when read; a final decode reports those that never finished. */
  running: string[];
  /** Messages reported last, newest last: a message that changes after it finished is read again. */
  reported: string[];
}

/** The state a cursor carries back, reading only the fields it understands; a wrong-typed id in a list is dropped. */
const SqliteSavedSettlement = z.looseObject({
  updated: lenient(z.number()),
  id: lenient(z.string()),
  row: lenient(z.number()),
  running: lenient(z.array(lenient(z.string()))),
  reported: lenient(z.array(lenient(z.string())))
});

/** Restores the settlement state a cursor carries, reading only the fields it understands. */
function restoreSqliteSettlement(saved: unknown): SqliteSettlementState {
  const state = z.safeParse(SqliteSavedSettlement, saved).data;
  const ids = (value: readonly (string | undefined)[] | undefined): string[] =>
    value?.filter((id): id is string => id !== undefined) ?? [];
  const row = state?.row;
  return {
    updated: state?.updated ?? 0,
    id: state?.id ?? "",
    ...(row === undefined ? {} : { row }),
    running: ids(state?.running),
    reported: ids(state?.reported)
  };
}

/** When an agent's messages count as usage, over the rows the queries feed it. */
export interface SqliteSettlement {
  /** Where the next page starts: by row id during the first pass (`row`), else from the newest change seen. */
  position(): { readonly row?: number; readonly updated: number; readonly id: string };
  /** Ends the first pass by row id; the pages that follow go by the newest change. */
  endByRow(): void;
  /**
   * Settles one page of rows in order and returns the messages it reports. A running message is only remembered (its
   * counts may still grow); a finished one reports once, the newest ones remembered first.
   */
  push(rows: readonly SqliteTableRow[]): UsageRecord[];
  /** The messages that were running when the pages were read, for the final look at them. */
  runningIds(): readonly string[];
  /**
   * The final look: a running message whose row is gone was deleted; the rest report at their creation time. The rows
   * it re-fetches by id do not move the position: the pages that follow still go by the newest change the page reads
   * saw.
   */
  end(rows: readonly SqliteTableRow[]): UsageRecord[];
  /** The state as the cursor keeps it. */
  save(): SqliteSettlementState;
}

/** A message runs far shorter than this, so a row created this long before `since` holds no record to keep. */
export const SQLITE_LONGEST_MESSAGE_MS: number = 24 * 60 * 60 * 1000;

/** How many running messages a cursor remembers; one that never finishes is dropped once newer ones push it out. */
export const SQLITE_RUNNING_IDS: number = 64;

/** How many reported message ids the cursor remembers; a message that changes again after more than this counts again. */
const REPORTED_IDS = 256;

/** The `time_created` a query may start at: a day before `since`, since a message created before it can still end inside the window. */
export function sqliteQueryFloor(since: number | undefined): number {
  return since === undefined ? 0 : since - SQLITE_LONGEST_MESSAGE_MS;
}

/**
 * The settlement of one decode of an agent's message database, from the state a previous decode saved. The first read
 * of a database goes by row id, one pass over the table; a continuing one reads the rows changed after the newest
 * change the previous read saw. Each row's JSON goes to `decode`, with where it came from and, on a final decode, the
 * time an unfinished message counts at.
 */
export function createSqliteSettlement(
  decode: SqliteMessageDecode,
  options: { readonly path: string; readonly state?: unknown; readonly final: boolean }
): SqliteSettlement {
  const state = restoreSqliteSettlement(options.state);
  if (state.updated === 0 && state.id === "") {
    state.row ??= 0;
  }
  const messageOf = (row: SqliteTableRow): UsageRecord | "running" | undefined => {
    let value: unknown;
    try {
      value = JSON.parse(row.data) as unknown;
    } catch {
      return undefined;
    }
    return decode(value, {
      id: row.id,
      ...(row.sessionId === undefined ? {} : { sessionId: row.sessionId }),
      source: { file: options.path, offset: 0, length: 0, line: row.row },
      ...(options.final ? { settledAt: row.created } : {})
    });
  };
  const settle = (row: SqliteTableRow, out: UsageRecord[]): void => {
    const message = messageOf(row);
    if (message === "running") {
      if (!state.running.includes(row.id)) {
        rememberKey(state.running, row.id, SQLITE_RUNNING_IDS);
      }
      return;
    }
    state.running = state.running.filter((running) => running !== row.id);
    if (message && !state.reported.includes(row.id)) {
      rememberKey(state.reported, row.id, REPORTED_IDS);
      out.push(message);
    }
  };
  const push = (rows: readonly SqliteTableRow[]): UsageRecord[] => {
    const out: UsageRecord[] = [];
    for (const row of rows) {
      if (state.row !== undefined) {
        state.row = row.row;
        if (row.updated > state.updated || (row.updated === state.updated && row.id > state.id)) {
          state.updated = row.updated;
          state.id = row.id;
        }
      } else {
        state.updated = row.updated;
        state.id = row.id;
      }
      settle(row, out);
    }
    return out;
  };
  return {
    position: () => ({ ...(state.row === undefined ? {} : { row: state.row }), updated: state.updated, id: state.id }),
    endByRow: () => {
      delete state.row;
    },
    push,
    runningIds: () => [...state.running],
    end(rows) {
      // Only once the query has answered: a running message whose row is gone was deleted.
      const present = new Set(rows.map((row) => row.id));
      state.running = state.running.filter((id) => present.has(id));
      const out: UsageRecord[] = [];
      for (const row of rows) {
        settle(row, out);
      }
      return out;
    },
    save: () => structuredClone(state)
  };
}

/**
 * The `message` rows after a row id, a page at a time, for the first read of a database: the row id is indexed, so the
 * read is one pass. It finds the rows in the order they were inserted.
 */
const SQLITE_MESSAGES_BY_ROW: string =
  "SELECT rowid AS row, id, session_id, time_created, time_updated, data FROM message " +
  "WHERE rowid > ? AND time_created >= ? ORDER BY rowid LIMIT ?";

/**
 * The `message` rows changed after a position, by the time they were last updated and then by id, a page at a time.
 * Row ids are no position: the agents delete messages after a reverted one, and SQLite gives the next inserted row a
 * deleted row's id. A message changes again when it finishes, so an update moves it after the position. No index
 * covers the order, so each page sorts the rows changed since; a decode that continues finds few of them.
 */
const SQLITE_MESSAGE_PAGE: string =
  "SELECT rowid AS row, id, session_id, time_created, time_updated, data FROM message " +
  "WHERE (time_updated > ? OR (time_updated = ? AND id > ?)) AND time_created >= ? " +
  "ORDER BY time_updated, id LIMIT ?";

/** Message rows by id, to look again at messages that were still running when a decode stopped. */
function sqliteMessagesById(count: number): string {
  return `SELECT rowid AS row, id, session_id, time_created, time_updated, data FROM message WHERE id IN (${Array.from(
    { length: count },
    () => "?"
  ).join(", ")})`;
}

/** Rows read per query, so a large database is not loaded whole. */
const SQLITE_PAGE_ROWS = 500;

/** A `message` page row; only `session_id` is read by type, the other columns are coerced in `toRows`. */
const messageRow = z.looseObject({ session_id: lenient(z.string()) });

/**
 * The database's source when the file exists: the newer of the database's and its WAL's mtimes, so a change in either
 * is seen, with the database's size. `undefined` when there is no database file.
 */
export async function sqliteMessageSource(
  platform: UsagePlatform,
  agent: CodingAgentId,
  path: string,
  walSuffix: string
): Promise<UsageSource | undefined> {
  const info = await platform.fs.stat(path, { followSymlinks: true });
  if (info?.kind !== "file") {
    return undefined;
  }
  const wal = await platform.fs.stat(`${path}${walSuffix}`, { followSymlinks: true });
  return {
    agent,
    id: basenamePath(path),
    path,
    mtimeMs: Math.max(info.mtimeMs, wal?.kind === "file" ? wal.mtimeMs : 0),
    sizeBytes: info.size
  };
}

/** What a decode of an agent's message database reads, besides the provider's own row decoding. */
export interface SqliteMessagesRequest {
  readonly agent: CodingAgentId;
  readonly platform: UsagePlatform;
  /** The database file's path; its WAL file is it plus `walSuffix`. */
  readonly path: string;
  readonly walSuffix: string;
  readonly options: DecodeUsageOptions;
}

/** The `ReadFailed` a decode yields for a SQLite error the platform did not classify: the thrown value's message, kept for the report. */
function readFailed(path: string, cause: unknown): ReadFailed {
  return { _tag: "ReadFailed", path, message: cause instanceof Error ? cause.message : String(cause), cause };
}

/**
 * The finished assistant messages of an agent's `message` table, in the order they last changed, through the
 * settlement rules: this decoder only pages the queries and feeds their rows to `decode`. A running message is not
 * reported yet: it changes again when it finishes and is read then. A decode of a quiet database is final, so a
 * message that never finished counts at its creation time. The first read goes by row id, a single pass over the
 * table; a continuing one reads the rows changed after the newest change the previous decode saw.
 */
export function decodeSqliteMessages(decode: SqliteMessageDecode, request: SqliteMessagesRequest): UsageStream {
  const { agent, platform, path, walSuffix, options } = request;
  const { from, signal } = options;
  const fail = (error: UsageDecodeError): UsageDecodeFailure => ({ agent, path, error });
  return usageStreamOf(async function* (position) {
    const sqlite = platform.sqlite;
    if (!sqlite) {
      yield fail({ _tag: "SqliteUnavailable", path });
      return;
    }
    const io = guardIo(platform);
    let source: UsageSource | undefined;
    try {
      source = await sqliteMessageSource(platform, agent, path, walSuffix);
    } catch (error) {
      signal?.throwIfAborted();
      const failure = io.failure(error, path);
      if (!failure) {
        throw error;
      }
      yield fail(failure);
      return;
    }
    if (source === undefined) {
      yield fail({ _tag: "SessionNotFound", path });
      return;
    }
    const changed = source.mtimeMs;
    const final = decodeIsFinal(options, changed);
    const settlement = createSqliteSettlement(decode, {
      path,
      ...(from?.state !== undefined ? { state: from.state } : {}),
      final
    });
    const queue: UsageRecord[] = [...(from?.queue ?? [])];
    position.cursor = () => ({
      agent,
      offset: 0,
      line: 0,
      state: settlement.save(),
      ...(queue.length > 0 ? { queue: [...queue] } : {})
    });
    yield* drain(queue);
    const sqliteErrors = new WeakSet<object>();
    let db: SqliteDatabase | undefined;
    const query = (sql: string, ...params: SqliteValue[]): Record<string, SqliteValue>[] => {
      try {
        db ??= sqlite.open(path, { readonly: true });
        return db.prepare(sql).all(...params);
      } catch (error) {
        // WeakSet bookkeeping only; the thrown value is not parsed or changed.
        if (typeof error === "object" && error !== null) {
          sqliteErrors.add(error);
        }
        throw error;
      }
    };
    const earliest = sqliteQueryFloor(options.since);
    const toRows = (rows: Record<string, SqliteValue>[]): SqliteTableRow[] =>
      rows.map((row) => {
        const sessionId = z.safeParse(messageRow, row).data?.session_id;
        return {
          id: String(row.id),
          row: Number(row.row),
          updated: Number(row.time_updated),
          created: Number(row.time_created),
          ...(sessionId === undefined ? {} : { sessionId }),
          data: String(row.data)
        };
      });
    try {
      // The first read goes by row id, a single pass over the table; the following pages go by the newest change.
      // The settled records go through `queue`, so the ones a loop left early keeps are saved with the cursor.
      while (settlement.position().row !== undefined) {
        signal?.throwIfAborted();
        const at = settlement.position().row!;
        const rows = query(SQLITE_MESSAGES_BY_ROW, at, earliest, SQLITE_PAGE_ROWS);
        queue.push(...settlement.push(toRows(rows)));
        yield* drain(queue);
        if (rows.length < SQLITE_PAGE_ROWS) {
          settlement.endByRow();
        }
      }
      for (;;) {
        signal?.throwIfAborted();
        const at = settlement.position();
        const rows = query(SQLITE_MESSAGE_PAGE, at.updated, at.updated, at.id, earliest, SQLITE_PAGE_ROWS);
        queue.push(...settlement.push(toRows(rows)));
        yield* drain(queue);
        if (rows.length < SQLITE_PAGE_ROWS) {
          break;
        }
      }
      const running = settlement.runningIds();
      if (final && running.length > 0) {
        const rows = query(sqliteMessagesById(running.length), ...running);
        queue.push(...settlement.end(toRows(rows)));
        yield* drain(queue);
      }
    } catch (error) {
      signal?.throwIfAborted();
      // WeakSet bookkeeping only; the thrown value is not parsed or changed.
      if (typeof error !== "object" || error === null || !sqliteErrors.has(error)) {
        throw error;
      }
      yield fail(readFailed(path, error));
    } finally {
      db?.close();
    }
  }, from);
}
