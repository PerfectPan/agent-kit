import type { AgentHome } from "@rivus/agent-kit-catalog";
import type { SqliteDatabase, SqliteValue } from "@rivus/agent-kit-platform";

import { asNumber, asRecord, asString } from "../../../domain/protocols/record-fields.js";
import { rememberKey } from "../../../domain/adapters/usage-lines.js";
import {
  OPENCODE_MESSAGE_PAGE,
  OPENCODE_MESSAGES_BY_ROW,
  opencodeDatabasePath,
  opencodeLegacyMessageRoot,
  opencodeMessagesById,
  opencodeMessageUsage,
  opencodeUsageKey
} from "../../../domain/adapters/opencode/index.js";
import { basenamePath, joinPath, type ReadFailed } from "../../../domain/session/index.js";
import type { UsageRecord } from "../../../domain/usage/index.js";
import { guardIo } from "../files/io-failure.js";
import { readText } from "../files/read-file.js";
import type {
  UsageDecodeError,
  UsageDecodeFailure,
  DecodeUsageOptions,
  UsageDecoder,
  UsagePlatform,
  UsageSource,
  UsageSourceFailure,
  UsageStream
} from "../../usage-ports.js";
import { drain, usageStreamOf } from "./files.js";

const AGENT = "opencode";

/** Rows read per query, so a large database is not loaded whole. */
const PAGE_ROWS = 500;

/** A message runs far shorter than this, so a row created this long before `since` holds no record to keep. */
const LONGEST_MESSAGE_MS = 24 * 60 * 60 * 1000;

/** How many running messages a cursor remembers; one that never finishes is dropped once newer ones push it out. */
const RUNNING_IDS = 64;

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
    return target.path.endsWith(".db")
      ? decodeDatabase(platform, target.path, options)
      : decodeLegacySession(platform, target.path, options);
  }
};

async function listSources(
  platform: UsagePlatform,
  home: AgentHome,
  signal: AbortSignal | undefined
): Promise<(UsageSource | UsageSourceFailure)[]> {
  const database = opencodeDatabasePath(home);
  const info = await platform.fs.stat(database, { followSymlinks: true });
  if (info?.kind === "file") {
    const wal = await platform.fs.stat(`${database}-wal`, { followSymlinks: true });
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

interface DatabaseState {
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

/** How many reported message ids the cursor remembers; a message that changes again after more than this counts again. */
const REPORTED_IDS = 256;

/**
 * The finished assistant messages of the database, in the order they last changed. A running message is not reported
 * yet: it changes again when it finishes and is read then. With `final`, a message that never finished counts at its
 * creation time, like presence counts it.
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
      const wal = await io.platform.fs.stat(`${path}-wal`, { followSymlinks: true });
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
    const final = options.final === true || (options.quietBefore !== undefined && changed < options.quietBefore);
    const state = restoreDatabase(from?.state);
    const queue: UsageRecord[] = [...(from?.queue ?? [])];
    position.cursor = () => ({
      agent: AGENT,
      offset: 0,
      line: 0,
      state: structuredClone(state),
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
        if (typeof error === "object" && error !== null) {
          sqliteErrors.add(error);
        }
        throw error;
      }
    };
    const take = (row: Record<string, SqliteValue>): void => {
      const id = String(row.id);
      const message = opencodeRow(row, path, final);
      if (message === "running") {
        if (!state.running.includes(id)) {
          rememberKey(state.running, id, RUNNING_IDS);
        }
        return;
      }
      state.running = state.running.filter((running) => running !== id);
      if (message && !state.reported.includes(id)) {
        rememberKey(state.reported, id, REPORTED_IDS);
        queue.push(message);
      }
    };
    try {
      const earliest = options.since === undefined ? 0 : options.since - LONGEST_MESSAGE_MS;
      if (state.updated === 0 && state.id === "") {
        state.row ??= 0;
      }
      // The first read goes by row id, a single pass over the table, and remembers the latest change it saw.
      while (state.row !== undefined) {
        signal?.throwIfAborted();
        const rows = query(OPENCODE_MESSAGES_BY_ROW, state.row, earliest, PAGE_ROWS);
        for (const row of rows) {
          state.row = Number(row.row);
          const updated = Number(row.time_updated);
          const id = String(row.id);
          if (updated > state.updated || (updated === state.updated && id > state.id)) {
            state.updated = updated;
            state.id = id;
          }
          take(row);
        }
        if (rows.length < PAGE_ROWS) {
          delete state.row;
        }
        yield* drain(queue);
      }
      for (;;) {
        signal?.throwIfAborted();
        const rows = query(OPENCODE_MESSAGE_PAGE, state.updated, state.updated, state.id, earliest, PAGE_ROWS);
        for (const row of rows) {
          state.updated = Number(row.time_updated);
          state.id = String(row.id);
          take(row);
        }
        yield* drain(queue);
        if (rows.length < PAGE_ROWS) {
          break;
        }
      }
      if (final && state.running.length > 0) {
        const rows = query(opencodeMessagesById(state.running.length), ...state.running);
        // Only once the query has answered: a running message whose row is gone was deleted.
        const present = new Set(rows.map((row) => String(row.id)));
        state.running = state.running.filter((id) => present.has(id));
        for (const row of rows) {
          take(row);
        }
        yield* drain(queue);
      }
    } catch (error) {
      signal?.throwIfAborted();
      if (typeof error !== "object" || error === null || !sqliteErrors.has(error)) {
        throw error;
      }
      yield fail(readFailed(path, error));
    } finally {
      db?.close();
    }
  }, from);
}

/** The usage of one `message` row; a row whose `data` is not JSON is skipped. */
function opencodeRow(
  row: Record<string, SqliteValue>,
  path: string,
  final: boolean
): UsageRecord | "running" | undefined {
  let value: unknown;
  try {
    value = JSON.parse(String(row.data)) as unknown;
  } catch {
    return undefined;
  }
  const sessionId = asString(row.session_id);
  return opencodeMessageUsage(value, {
    id: String(row.id),
    ...(sessionId === undefined ? {} : { sessionId }),
    source: { file: path, offset: 0, length: 0, line: Number(row.row) },
    ...(final ? { settledAt: Number(row.time_created) } : {})
  });
}

function restoreDatabase(saved: unknown): DatabaseState {
  const state = asRecord(saved);
  const ids = (value: unknown): string[] =>
    Array.isArray(value) ? value.filter((id): id is string => typeof id === "string") : [];
  const row = asNumber(state?.row);
  return {
    updated: asNumber(state?.updated) ?? 0,
    id: asString(state?.id) ?? "",
    ...(row === undefined ? {} : { row }),
    running: ids(state?.running),
    reported: ids(state?.reported)
  };
}

/**
 * The assistant messages of one session directory of the older JSON layout, one file each, in name order (opencode's
 * message ids grow with time). The cursor keeps the last file name read.
 */
function decodeLegacySession(platform: UsagePlatform, dir: string, options: DecodeUsageOptions): UsageStream {
  const { from, signal } = options;
  return usageStreamOf(async function* (position) {
    const io = guardIo(platform);
    let after = asString(asRecord(from?.state)?.after);
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
        .filter((entry) => entry.kind === "file" && entry.name.endsWith(".json"))
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

function readFailed(path: string, cause: unknown): ReadFailed {
  return { _tag: "ReadFailed", path, message: cause instanceof Error ? cause.message : String(cause), cause };
}
