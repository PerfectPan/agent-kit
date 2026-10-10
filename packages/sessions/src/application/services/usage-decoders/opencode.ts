import type { AgentHome } from "@rivus/agent-kit-catalog";
import type { SqliteDatabase, SqliteValue } from "@rivus/agent-kit-platform";
import * as z from "zod/mini";

import { lenient } from "../../../domain/transcript/adapters/lenient.js";
import {
  OPENCODE_MESSAGE_PAGE,
  OPENCODE_MESSAGES_BY_ROW,
  opencodeDatabasePath,
  opencodeLegacyMessageRoot,
  opencodeMessagesById
} from "../../../domain/session/adapters/opencode.js";
import { opencodeMessageUsage, opencodeUsageKey } from "../../../domain/usage/adapters/opencode/usage.js";
import {
  type OpencodeTableRow,
  createOpencodeSettlement,
  opencodeQueryFloor
} from "../../../domain/usage/adapters/opencode/settlement.js";
import { basenamePath, joinPath, type ReadFailed } from "../../../domain/session/index.js";
import { decodeIsFinal, type UsageRecord } from "../../../domain/usage/index.js";
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
