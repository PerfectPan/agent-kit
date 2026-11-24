import { lenient, type SqliteDatabase } from "@rivus/agent-kit-sessions/spi";
import * as z from "zod/mini";
import { dimLedgerRowOf, type DimLedgerRowValue } from "../records.js";
import {
  dimCheckpointRowOf,
  dimMessageRowOf,
  dimRelationOf,
  dimSessionRowOf,
  dimTime,
  type DimCheckpointRowValue,
  type DimCheckpointValue,
  type DimMessageRow,
  type DimMessageValue,
  type DimRelationValue,
  type DimSessionRowValue
} from "./rows.js";

// The SQL of the session tables, with the column checks that let a database of an older DimCode load: `sessions`,
// `messages` and `usage_ledger` are the store itself, and every other table is read only when it exists with the
// columns its query names.

const TableName = z.looseObject({ name: z.string() });
const Rowid = z.looseObject({ rowid: z.union([z.number(), z.bigint()]) });
const RunStatsRow = z.looseObject({ runId: z.string(), durationMs: lenient(z.number()) });

/** Whether `table` exists with every column in `columns`. */
function hasTable(database: SqliteDatabase, table: string, columns: readonly string[]): boolean {
  const present = database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(table);
  if (z.safeParse(TableName, present).data?.name !== table) {
    return false;
  }
  const known = new Set(
    database
      .prepare(`PRAGMA table_info("${table}")`)
      .all()
      .map((column) => z.safeParse(TableName, column).data?.name)
  );
  return columns.every((column) => known.has(column));
}

/** A session's `sessions` row; `undefined` when the store has no such session. */
export function dimSessionRow(database: SqliteDatabase, sessionId: string): DimSessionRowValue | undefined {
  return dimSessionRowOf(
    database
      .prepare("SELECT sessionId, cwd, title, status, createdAt, updatedAt FROM sessions WHERE sessionId = ?")
      .get(sessionId)
  );
}

/** Every `sessions` row with the latest write of its messages and ledger, oldest update first; the rows `discover` lists. */
export function dimSessionRows(database: SqliteDatabase): DimSessionRowValue[] {
  return database
    .prepare(
      "SELECT s.sessionId, s.cwd, s.title, s.status, s.createdAt, s.updatedAt, " +
        "(SELECT MAX(m.updatedAt) FROM messages m WHERE m.sessionId = s.sessionId) AS latestMessageUpdatedAt, " +
        "(SELECT MAX(m.createdAt) FROM messages m WHERE m.sessionId = s.sessionId) AS latestMessageCreatedAt, " +
        "(SELECT MAX(l.createdAt) FROM usage_ledger l WHERE l.sessionId = s.sessionId) AS latestLedgerCreatedAt " +
        "FROM sessions s ORDER BY s.updatedAt"
    )
    .all()
    .map(dimSessionRowOf)
    .filter((row) => row !== undefined);
}

const MESSAGE_COLUMNS = "rowid, messageId, role, parts, metadata, createdAt";
const MESSAGE_ORDER = "FROM messages WHERE sessionId = ? ORDER BY orderKey";

function dimMessagesOf(rows: readonly unknown[]): DimMessageRow[] {
  return rows.map(dimMessageRowOf).filter((row) => row !== undefined);
}

/** A session's message rows in `orderKey` order. */
function dimMessages(database: SqliteDatabase, sessionId: string): DimMessageRow[] {
  return dimMessagesOf(database.prepare(`SELECT ${MESSAGE_COLUMNS} ${MESSAGE_ORDER}`).all(sessionId));
}

/** A page of a session's message rows in `orderKey` order. */
export function dimMessagePage(
  database: SqliteDatabase,
  sessionId: string,
  limit: number,
  offset: number
): DimMessageRow[] {
  return dimMessagesOf(
    database.prepare(`SELECT ${MESSAGE_COLUMNS} ${MESSAGE_ORDER} LIMIT ? OFFSET ?`).all(sessionId, limit, offset)
  );
}

/** A `usage_ledger` row with the rowid its request event's source names. */
export type DimLedgerRow = DimLedgerRowValue & { readonly rowid: number };

const LEDGER_COLUMNS = "rowid, ledgerId, sessionId, runId, providerId, modelId, usage, cost, createdAt";
const LEDGER_ORDER = "FROM usage_ledger WHERE sessionId = ? ORDER BY createdAt, rowid";

function dimLedgerRowsOf(rows: readonly unknown[]): DimLedgerRow[] {
  const ledger: DimLedgerRow[] = [];
  for (const row of rows) {
    const parsed = dimLedgerRowOf(row);
    const rowid = z.safeParse(Rowid, row).data?.rowid;
    if (parsed !== undefined && rowid !== undefined) {
      ledger.push({ ...parsed, rowid: Number(rowid) });
    }
  }
  return ledger;
}

/** A session's ledger rows, oldest first. */
function dimLedgerRows(database: SqliteDatabase, sessionId: string): DimLedgerRow[] {
  return dimLedgerRowsOf(database.prepare(`SELECT ${LEDGER_COLUMNS} ${LEDGER_ORDER}`).all(sessionId));
}

/** A page of a session's ledger rows, oldest first. */
export function dimLedgerPage(
  database: SqliteDatabase,
  sessionId: string,
  limit: number,
  offset: number
): DimLedgerRow[] {
  return dimLedgerRowsOf(
    database.prepare(`SELECT ${LEDGER_COLUMNS} ${LEDGER_ORDER} LIMIT ? OFFSET ?`).all(sessionId, limit, offset)
  );
}

/**
 * The `durationMs` each of a session's runs recorded in `usage_run_stats`: absent for a run without a finite,
 * non-negative one, and for every run when the table is missing.
 */
export function dimRunDurations(database: SqliteDatabase, sessionId: string): ReadonlyMap<string, number> {
  const durations = new Map<string, number>();
  if (!hasTable(database, "usage_run_stats", ["runId", "sessionId", "durationMs"])) {
    return durations;
  }
  const rows = database.prepare("SELECT runId, durationMs FROM usage_run_stats WHERE sessionId = ?").all(sessionId);
  for (const row of rows) {
    const parsed = z.safeParse(RunStatsRow, row).data;
    if (parsed?.durationMs !== undefined && Number.isFinite(parsed.durationMs) && parsed.durationMs >= 0) {
      durations.set(parsed.runId, parsed.durationMs);
    }
  }
  return durations;
}

/** The duration of `runId` for the first ledger row of the run that takes one, since a run's rows share one entry. */
export function dimTakeRunDuration(
  runId: string | undefined,
  runDurations: ReadonlyMap<string, number>,
  consumedRuns: Set<string>
): number | undefined {
  if (runId === undefined || consumedRuns.has(runId)) {
    return undefined;
  }
  const durationMs = runDurations.get(runId);
  if (durationMs !== undefined) {
    consumedRuns.add(runId);
  }
  return durationMs;
}

/** A session's `compaction_states` row: one checkpoint per compaction DimCode applied; `undefined` without the table or the row. */
export function dimCheckpoints(database: SqliteDatabase, sessionId: string): DimCheckpointRowValue | undefined {
  if (!hasTable(database, "compaction_states", ["sessionId", "checkpoints"])) {
    return undefined;
  }
  return dimCheckpointRowOf(
    database.prepare("SELECT rowid, checkpoints FROM compaction_states WHERE sessionId = ?").get(sessionId)
  );
}

/** Everything `load` translates for one session: its messages, ledger, run durations and compaction checkpoints. */
export interface DimLaneRows {
  readonly messages: readonly DimMessageRow[];
  readonly ledger: readonly DimLedgerRow[];
  readonly runDurations: ReadonlyMap<string, number>;
  readonly checkpoints: DimCheckpointRowValue | undefined;
}

const RunIdRow = z.looseObject({ runId: z.string() });

/**
 * Excludes inherited history from a forked subagent (`forkContext: "all"`): DimCode's `forkSessionForAgent` clones
 * the parent's messages (with `msg_fork_` ids and original `createdAt`), compaction checkpoints (remapped to those
 * `msg_fork_` ids), and `usage_ledger` rows (keeping the parent's `runId` and `createdAt`).
 */
export interface DimForkFilter {
  readonly cutoffMs: number;
  readonly parentRunIds: ReadonlySet<string>;
}

/** Builds the inherited-history filter for a forked subagent lane from its parent's ledger and the fork timestamp. */
export function dimForkFilter(
  database: SqliteDatabase,
  parentSessionId: string,
  childCreatedAt: string | undefined,
  relationCreatedAt: number
): DimForkFilter {
  const parentRunIds = new Set<string>();
  const rows = database
    .prepare("SELECT DISTINCT runId FROM usage_ledger WHERE sessionId = ? AND runId IS NOT NULL")
    .all(parentSessionId);
  for (const row of rows) {
    const runId = z.safeParse(RunIdRow, row).data?.runId;
    if (runId !== undefined) {
      parentRunIds.add(runId);
    }
  }
  const childMs = dimTime(childCreatedAt);
  return { cutoffMs: childMs > 0 ? childMs : relationCreatedAt, parentRunIds };
}

/** Whether a message row was cloned from the parent when forking a subagent session. */
export function isForkedMessage(message: DimMessageValue, filter: DimForkFilter): boolean {
  return (
    message.messageId.startsWith("msg_fork_") ||
    (filter.cutoffMs > 0 && message.createdAt > 0 && message.createdAt < filter.cutoffMs)
  );
}

/** Whether a compaction checkpoint was cloned from the parent when forking a subagent session. */
export function isForkedCheckpoint(checkpoint: DimCheckpointValue, filter: DimForkFilter): boolean {
  return (
    checkpoint.cursorMessageId.startsWith("msg_fork_") ||
    (filter.cutoffMs > 0 && checkpoint.createdAt > 0 && checkpoint.createdAt < filter.cutoffMs)
  );
}

/** Whether a ledger row was cloned from the parent when forking a subagent session. */
export function isForkedLedgerRow(row: DimLedgerRow, filter: DimForkFilter): boolean {
  const createdAt = dimTime(row.createdAt);
  return (
    (row.runId !== undefined && filter.parentRunIds.has(row.runId)) ||
    (filter.cutoffMs > 0 && createdAt > 0 && createdAt < filter.cutoffMs)
  );
}

/** A session's rows as `load` translates them, excluding inherited history when `forkFilter` is set. */
export function dimLaneRows(database: SqliteDatabase, sessionId: string, forkFilter?: DimForkFilter): DimLaneRows {
  const allMessages = dimMessages(database, sessionId);
  const allLedger = dimLedgerRows(database, sessionId);
  const allCheckpoints = dimCheckpoints(database, sessionId);
  if (forkFilter === undefined) {
    return {
      messages: allMessages,
      ledger: allLedger,
      runDurations: dimRunDurations(database, sessionId),
      checkpoints: allCheckpoints
    };
  }
  const checkpoints =
    allCheckpoints === undefined
      ? undefined
      : {
          ...allCheckpoints,
          checkpoints: allCheckpoints.checkpoints.filter((checkpoint) => !isForkedCheckpoint(checkpoint, forkFilter))
        };
  return {
    messages: allMessages.filter((row) => row.value === undefined || !isForkedMessage(row.value, forkFilter)),
    ledger: allLedger.filter((row) => !isForkedLedgerRow(row, forkFilter)),
    runDurations: dimRunDurations(database, sessionId),
    checkpoints
  };
}

/**
 * The `subagent` relations of the database, oldest first: those with `sourceSessionId` as their source when given,
 * else every one, with the source of each.
 */
export function dimSubagentRelations(database: SqliteDatabase, sourceSessionId?: string): DimRelationValue[] {
  if (
    !hasTable(database, "session_relations", [
      "sourceSessionId",
      "targetSessionId",
      "relationType",
      "typeData",
      "createdAt"
    ])
  ) {
    return [];
  }
  const ofSource = sourceSessionId !== undefined;
  const statement = database.prepare(
    "SELECT sourceSessionId, targetSessionId, typeData, createdAt FROM session_relations " +
      `WHERE relationType = 'subagent'${ofSource ? " AND sourceSessionId = ?" : ""} ORDER BY createdAt, relationId`
  );
  const rows = ofSource ? statement.all(sourceSessionId) : statement.all();
  return rows.map(dimRelationOf).filter((relation) => relation !== undefined);
}
