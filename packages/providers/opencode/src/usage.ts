import type { AgentHome } from "@rivus/agent-kit-catalog/spi";
import * as z from "zod/mini";
import {
  type SourcePointer,
  compactUsage,
  type Usage,
  type UsageRecord,
  lenient,
  rememberKey,
  basenamePath,
  joinPath,
  type ReadFailed,
  decodeIsFinal,
  guardIo,
  readText,
  type UsageDecodeError,
  type UsageDecodeFailure,
  type DecodeUsageOptions,
  type UsageDecoder,
  type UsagePlatform,
  type UsageSource,
  type UsageSourceFailure,
  type UsageStream,
  drain,
  usageStreamOf
} from "@rivus/agent-kit-sessions/spi";
import {
  OPENCODE_ID as AGENT,
  OPENCODE_MESSAGE_SUFFIX,
  OPENCODE_DATABASE_SUFFIX,
  OPENCODE_WAL_SUFFIX
} from "./facts.js";
import { opencodeDatabasePath, opencodeLegacyMessageRoot } from "./layout.js";

type SqliteDatabase = ReturnType<NonNullable<UsagePlatform["sqlite"]>["open"]>;
type SqliteValue = Parameters<ReturnType<SqliteDatabase["prepare"]>["all"]>[number];

/**
 * The `tokens` of a stored message. opencode counts `input` without the cache and `output` without reasoning (its
 * `total` is the sum of all five counts), so both are added back.
 */
const OpencodeTokens = z.looseObject({
  input: lenient(z.number()),
  output: lenient(z.number()),
  reasoning: lenient(z.number()),
  total: lenient(z.number()),
  cache: lenient(z.looseObject({ read: lenient(z.number()), write: lenient(z.number()) }))
});

type OpencodeTokensValue = z.output<typeof OpencodeTokens>;

/** The Usage of a stored message's parsed `tokens`, with the cache and reasoning added back. */
function opencodeUsage(tokens: OpencodeTokensValue | undefined): Usage | undefined {
  const input = tokens?.input;
  const output = tokens?.output;
  const reasoning = tokens?.reasoning;
  const cacheRead = tokens?.cache?.read;
  const cacheWrite = tokens?.cache?.write;
  return compactUsage({
    inputTokens: input === undefined ? undefined : input + (cacheRead ?? 0) + (cacheWrite ?? 0),
    outputTokens: output === undefined ? undefined : output + (reasoning ?? 0),
    totalTokens: tokens?.total,
    cacheReadTokens: cacheRead,
    cacheWriteTokens: cacheWrite,
    reasoningTokens: reasoning
  });
}

/** Where a stored message comes from, besides its JSON. */
interface OpencodeMessageRow {
  /** The message id, which becomes the record's request id. */
  readonly id?: string;
  readonly sessionId?: string;
  readonly source: SourcePointer;
  /**
   * Set when the message cannot run any more: the store is complete, or it is the older JSON layout, which opencode no
   * longer writes. An assistant message without a completion time then stopped unfinished, and counts at its creation
   * time, else at this time.
   */
  readonly settledAt?: number;
}

/** A stored message and the fields its usage rules read. */
const OpencodeMessage = z.looseObject({
  id: lenient(z.string()),
  role: lenient(z.string()),
  sessionID: lenient(z.string()),
  modelID: lenient(z.string()),
  providerID: lenient(z.string()),
  cost: lenient(z.number()),
  time: lenient(z.looseObject({ created: lenient(z.number()), completed: lenient(z.number()) })),
  tokens: lenient(OpencodeTokens)
});

/**
 * The usage of one stored message: `undefined` for a message that is not an assistant's or has no token counts, and
 * `running` for an assistant message that has not finished (opencode sets `time.completed` when it ends, also on an
 * error or an abort), whose counts may still grow. opencode logs the message's cost, which is kept as the agent's.
 */
export function opencodeMessageUsage(value: unknown, row: OpencodeMessageRow): UsageRecord | "running" | undefined {
  const message = z.safeParse(OpencodeMessage, value).data;
  if (message?.role !== "assistant") {
    return undefined;
  }
  const timestamp =
    message.time?.completed ?? (row.settledAt === undefined ? undefined : (message.time?.created ?? row.settledAt));
  if (timestamp === undefined) {
    return "running";
  }
  const usage = opencodeUsage(message.tokens);
  if (!usage) {
    return undefined;
  }
  const id = message.id ?? row.id;
  const record: UsageRecord = {
    agent: AGENT,
    sessionId: message.sessionID ?? row.sessionId ?? "unknown",
    granularity: "request",
    ...(id ? { requestId: id } : {}),
    timestamp,
    usage,
    source: row.source
  };
  const { modelID: model, providerID: provider, cost } = message;
  if (model) {
    record.model = model;
  }
  if (provider) {
    record.provider = provider;
  }
  if (cost !== undefined) {
    record.costUsd = cost;
    record.costSource = "agent";
  }
  return record;
}

/** The key under which a scan counts a record once in its window: the session and the message id. */
function opencodeUsageKey(record: UsageRecord): string | undefined {
  return record.requestId === undefined ? undefined : `${record.sessionId} ${record.requestId}`;
}

/** A message runs far shorter than this, so a row created this long before `since` holds no record to keep. */
export const LONGEST_MESSAGE_MS: number = 24 * 60 * 60 * 1000;

/** How many running messages a cursor remembers; one that never finishes is dropped once newer ones push it out. */
export const RUNNING_IDS: number = 64;

/** How many reported message ids the cursor remembers; a message that changes again after more than this counts again. */
const REPORTED_IDS = 256;

/** The `time_updated` a query may start at: a day before `since`, since a message created before it can still end inside the window. */
export function opencodeQueryFloor(since: number | undefined): number {
  return since === undefined ? 0 : since - LONGEST_MESSAGE_MS;
}

/** One row of opencode's `message` table, as the settlement rules read it. */
export interface OpencodeTableRow {
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

/** Where a decode of the database stopped, as plain JSON data for the cursor to carry. */
interface OpencodeSettlementState {
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
const OpencodeSavedSettlement = z.looseObject({
  updated: lenient(z.number()),
  id: lenient(z.string()),
  row: lenient(z.number()),
  running: lenient(z.array(lenient(z.string()))),
  reported: lenient(z.array(lenient(z.string())))
});

/** Restores the settlement state a cursor carries, reading only the fields it understands. */
function restoreOpencodeSettlement(saved: unknown): OpencodeSettlementState {
  const state = z.safeParse(OpencodeSavedSettlement, saved).data;
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

/** When opencode's messages count as usage, over the rows the queries feed it. */
interface OpencodeSettlement {
  /** Where the next page starts: by row id during the first pass (`row`), else from the newest change seen. */
  position(): { readonly row?: number; readonly updated: number; readonly id: string };
  /** Ends the first pass by row id; the pages that follow go by the newest change. */
  endByRow(): void;
  /**
   * Settles one page of rows in order and returns the messages it reports. A running message is only remembered (its
   * counts may still grow); a finished one reports once, the newest ones remembered first.
   */
  push(rows: readonly OpencodeTableRow[]): UsageRecord[];
  /** The messages that were running when the pages were read, for the final look at them. */
  runningIds(): readonly string[];
  /**
   * The final look: a running message whose row is gone was deleted; the rest report at their creation time, like
   * presence counts them. The rows it re-fetches by id do not move the position: the pages that follow still go by
   * the newest change the page reads saw.
   */
  end(rows: readonly OpencodeTableRow[]): UsageRecord[];
  /** The state as the cursor keeps it. */
  save(): OpencodeSettlementState;
}

/**
 * The settlement of one decode of opencode's database, from the state a previous decode saved. The first read of a
 * database goes by row id, one pass over the table; a continuing one reads the rows changed after the newest change
 * the previous read saw.
 */
export function createOpencodeSettlement(
  path: string,
  options: { readonly state?: unknown; readonly final: boolean }
): OpencodeSettlement {
  const state = restoreOpencodeSettlement(options.state);
  if (state.updated === 0 && state.id === "") {
    state.row ??= 0;
  }
  const messageOf = (row: OpencodeTableRow): UsageRecord | "running" | undefined => {
    let value: unknown;
    try {
      value = JSON.parse(row.data) as unknown;
    } catch {
      return undefined;
    }
    return opencodeMessageUsage(value, {
      id: row.id,
      ...(row.sessionId === undefined ? {} : { sessionId: row.sessionId }),
      source: { file: path, offset: 0, length: 0, line: row.row },
      ...(options.final ? { settledAt: row.created } : {})
    });
  };
  const settle = (row: OpencodeTableRow, out: UsageRecord[]): void => {
    const message = messageOf(row);
    if (message === "running") {
      if (!state.running.includes(row.id)) {
        rememberKey(state.running, row.id, RUNNING_IDS);
      }
      return;
    }
    state.running = state.running.filter((running) => running !== row.id);
    if (message && !state.reported.includes(row.id)) {
      rememberKey(state.reported, row.id, REPORTED_IDS);
      out.push(message);
    }
  };
  const push = (rows: readonly OpencodeTableRow[]): UsageRecord[] => {
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
const OPENCODE_MESSAGES_BY_ROW: string =
  "SELECT rowid AS row, id, session_id, time_created, time_updated, data FROM message " +
  "WHERE rowid > ? AND time_created >= ? ORDER BY rowid LIMIT ?";

/**
 * The `message` rows changed after a position, by the time they were last updated and then by id, a page at a time.
 * Row ids are no position: opencode deletes the messages after a reverted one, and SQLite gives the next inserted row a
 * deleted row's id. A message changes again when it finishes, so an update moves it after the position. No index
 * covers the order, so each page sorts the rows changed since; a decode that continues finds few of them.
 */
const OPENCODE_MESSAGE_PAGE: string =
  "SELECT rowid AS row, id, session_id, time_created, time_updated, data FROM message " +
  "WHERE (time_updated > ? OR (time_updated = ? AND id > ?)) AND time_created >= ? " +
  "ORDER BY time_updated, id LIMIT ?";

/** Message rows by id, to look again at messages that were still running when a decode stopped. */
function opencodeMessagesById(count: number): string {
  return `SELECT rowid AS row, id, session_id, time_created, time_updated, data FROM message WHERE id IN (${Array.from(
    { length: count },
    () => "?"
  ).join(", ")})`;
}

/** Rows read per query, so a large database is not loaded whole. */
const PAGE_ROWS = 500;

/** A `message` page row; only `session_id` is read by type, the other columns are coerced in `toRows`. */
const messageRow = z.looseObject({ session_id: lenient(z.string()) });

/** The cursor state of a legacy session directory: the last file name read. */
const legacyCursorState = z.looseObject({ after: lenient(z.string()) });

function readFailed(path: string, cause: unknown): ReadFailed {
  return { _tag: "ReadFailed", path, message: cause instanceof Error ? cause.message : String(cause), cause };
}

async function listSources(
  platform: UsagePlatform,
  home: AgentHome,
  signal: AbortSignal | undefined
): Promise<(UsageSource | UsageSourceFailure)[]> {
  const database = opencodeDatabasePath(home);
  const info = await platform.fs.stat(database, { followSymlinks: true });
  if (info?.kind === "file") {
    const wal = await platform.fs.stat(`${database}${OPENCODE_WAL_SUFFIX}`, { followSymlinks: true });
    const mtimeMs = Math.max(info.mtimeMs, wal?.kind === "file" ? wal.mtimeMs : 0);
    return [{ agent: AGENT, id: basenamePath(database), path: database, mtimeMs, sizeBytes: info.size }];
  }
  const root = opencodeLegacyMessageRoot(home);
  if ((await platform.fs.stat(root, { followSymlinks: true }))?.kind !== "dir") {
    const present = (await platform.fs.stat(home.path, { followSymlinks: true })) !== undefined;
    return present ? [] : [{ agent: AGENT, path: home.path, error: { _tag: "RootMissing", path: home.path } }];
  }
  const out: UsageSource[] = [];
  for (const entry of await platform.fs.list(root)) {
    signal?.throwIfAborted();
    const path = joinPath(root, entry.name);
    const dir = entry.kind === "dir" ? await platform.fs.stat(path) : undefined;
    if (dir) {
      out.push({ agent: AGENT, id: entry.name, path, mtimeMs: dir.mtimeMs });
    }
  }
  return out;
}

/**
 * The finished assistant messages of the database, in the order they last changed, through the agent's settlement
 * rules: this decoder only pages the queries and feeds their rows to them. A running message is not reported yet: it
 * changes again when it finishes and is read then. A decode of a quiet database is final, so a message that never
 * finished counts at its creation time.
 */
function decodeDatabase(platform: UsagePlatform, path: string, options: DecodeUsageOptions): UsageStream {
  const { from, signal } = options;
  const fail = (error: UsageDecodeError): UsageDecodeFailure => ({ agent: AGENT, path, error });
  return usageStreamOf(async function* (position) {
    const sqlite = platform.sqlite;
    if (!sqlite) {
      yield fail({ _tag: "SqliteUnavailable", path });
      return;
    }
    const io = guardIo(platform);
    let info: Awaited<ReturnType<UsagePlatform["fs"]["stat"]>>;
    let changed = 0;
    try {
      info = await io.platform.fs.stat(path, { followSymlinks: true });
      const wal = await io.platform.fs.stat(`${path}${OPENCODE_WAL_SUFFIX}`, { followSymlinks: true });
      changed = Math.max(info?.mtimeMs ?? 0, wal?.kind === "file" ? wal.mtimeMs : 0);
    } catch (error) {
      signal?.throwIfAborted();
      const failure = io.failure(error, path);
      if (!failure) {
        throw error;
      }
      yield fail(failure);
      return;
    }
    if (info?.kind !== "file") {
      yield fail({ _tag: "SessionNotFound", path });
      return;
    }
    const final = decodeIsFinal(options, changed);
    const settlement = createOpencodeSettlement(path, {
      ...(from?.state !== undefined ? { state: from.state } : {}),
      final
    });
    const queue: UsageRecord[] = [...(from?.queue ?? [])];
    position.cursor = () => ({
      agent: AGENT,
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
    const earliest = opencodeQueryFloor(options.since);
    const toRows = (rows: Record<string, SqliteValue>[]): OpencodeTableRow[] =>
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
        const rows = query(OPENCODE_MESSAGES_BY_ROW, at, earliest, PAGE_ROWS);
        queue.push(...settlement.push(toRows(rows)));
        yield* drain(queue);
        if (rows.length < PAGE_ROWS) {
          settlement.endByRow();
        }
      }
      for (;;) {
        signal?.throwIfAborted();
        const at = settlement.position();
        const rows = query(OPENCODE_MESSAGE_PAGE, at.updated, at.updated, at.id, earliest, PAGE_ROWS);
        queue.push(...settlement.push(toRows(rows)));
        yield* drain(queue);
        if (rows.length < PAGE_ROWS) {
          break;
        }
      }
      const running = settlement.runningIds();
      if (final && running.length > 0) {
        const rows = query(opencodeMessagesById(running.length), ...running);
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

/**
 * The assistant messages of one session directory of the older JSON layout, one file each, in name order (opencode's
 * message ids grow with time). The cursor keeps the last file name read.
 */
function decodeLegacySession(platform: UsagePlatform, dir: string, options: DecodeUsageOptions): UsageStream {
  const { from, signal } = options;
  return usageStreamOf(async function* (position) {
    const io = guardIo(platform);
    let after = z.safeParse(legacyCursorState, from?.state).data?.after;
    const queue: UsageRecord[] = [...(from?.queue ?? [])];
    position.cursor = () => ({
      agent: AGENT,
      offset: 0,
      line: 0,
      ...(after === undefined ? {} : { state: { after } }),
      ...(queue.length > 0 ? { queue: [...queue] } : {})
    });
    try {
      yield* drain(queue);
      if ((await io.platform.fs.stat(dir, { followSymlinks: true }))?.kind !== "dir") {
        yield { agent: AGENT, path: dir, error: { _tag: "SessionNotFound", path: dir } };
        return;
      }
      const names = (await io.platform.fs.list(dir))
        .filter((entry) => entry.kind === "file" && entry.name.endsWith(OPENCODE_MESSAGE_SUFFIX))
        .map((entry) => entry.name)
        .filter((name) => after === undefined || name > after)
        .toSorted();
      for (const name of names) {
        signal?.throwIfAborted();
        const file = joinPath(dir, name);
        const info = await io.platform.fs.stat(file, { followSymlinks: true });
        let value: unknown;
        try {
          value = JSON.parse(await readText(io.platform, file, signal ? { signal } : {})) as unknown;
        } catch (error) {
          if (!(error instanceof SyntaxError)) {
            throw error;
          }
        }
        const message = opencodeMessageUsage(value, {
          sessionId: basenamePath(dir),
          source: { file, offset: 0, length: info?.size ?? 0, line: 1 },
          settledAt: info?.mtimeMs ?? 0
        });
        after = name;
        if (message && message !== "running") {
          queue.push(message);
          yield* drain(queue);
        }
      }
    } catch (error) {
      signal?.throwIfAborted();
      const failure = io.failure(error, dir);
      if (!failure) {
        throw error;
      }
      yield { agent: AGENT, path: dir, error: failure };
    }
  }, from);
}

/**
 * opencode's database `<home>/opencode.db` when it exists, which needs `platform.sqlite`; otherwise each session
 * directory of the older JSON layout.
 */
export const opencodeUsageDecoder: UsageDecoder = {
  specificationVersion: "usage-v1",
  agent: AGENT,
  usageKey: opencodeUsageKey,
  async *sources(platform, home, options = {}) {
    const { since, signal } = options;
    signal?.throwIfAborted();
    let found: (UsageSource | UsageSourceFailure)[];
    try {
      found = await listSources(platform, home, signal);
    } catch (error) {
      signal?.throwIfAborted();
      found = [{ agent: AGENT, path: home.path, error: readFailed(home.path, error) }];
    }
    for (const item of found) {
      if ("error" in item || since === undefined || item.mtimeMs >= since) {
        yield item;
      }
    }
  },
  decode(platform, target, options = {}) {
    return target.path.endsWith(OPENCODE_DATABASE_SUFFIX)
      ? decodeDatabase(platform, target.path, options)
      : decodeLegacySession(platform, target.path, options);
  }
};
