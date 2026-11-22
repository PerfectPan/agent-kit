import type { AgentHome } from "@rivus/agent-kit-catalog/spi";
import * as z from "zod/mini";
import {
  SQLITE_LONGEST_MESSAGE_MS,
  SQLITE_RUNNING_IDS,
  compactUsage,
  createSqliteSettlement,
  decodeSqliteMessages,
  drain,
  guardIo,
  joinPath,
  lenient,
  usageStreamOf,
  basenamePath,
  readText,
  sqliteStoredMessageUsage,
  sqliteMessageSource,
  sqliteQueryFloor,
  yieldUsageSources,
  type DecodeUsageOptions,
  type SqliteMessageRow,
  type SqliteMessageTokens,
  type SqliteSettlement,
  type SqliteTableRow,
  type Usage,
  type UsageDecoder,
  type UsagePlatform,
  type UsageRecord,
  type UsageSource,
  type UsageSourceFailure,
  usageWindowKey,
  type UsageStream
} from "@rivus/agent-kit-sessions/spi";
import {
  OPENCODE_ID as AGENT,
  OPENCODE_MESSAGE_SUFFIX,
  OPENCODE_DATABASE_SUFFIX,
  OPENCODE_WAL_SUFFIX
} from "./facts.js";
import { opencodeDatabasePath, opencodeLegacyMessageRoot } from "./layout.js";

/** opencode counts `input` without the cache and `output` without reasoning, so both are added back. */
function opencodeUsage(tokens: SqliteMessageTokens | undefined): Usage | undefined {
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

/** The usage of one stored message; opencode logs the message's cost, which is kept as the agent's. */
export function opencodeMessageUsage(value: unknown, row: SqliteMessageRow): UsageRecord | "running" | undefined {
  return sqliteStoredMessageUsage(AGENT, value, row, { usageOf: opencodeUsage, messageIds: true });
}

/** A message runs far shorter than this, so a row created this long before `since` holds no record to keep. */
export const LONGEST_MESSAGE_MS: number = SQLITE_LONGEST_MESSAGE_MS;

/** How many running messages a cursor remembers; one that never finishes is dropped once newer ones push it out. */
export const RUNNING_IDS: number = SQLITE_RUNNING_IDS;

/** The `time_updated` a query may start at: a day before `since`, since a message created before it can still end inside the window. */
export const opencodeQueryFloor: (since: number | undefined) => number = sqliteQueryFloor;

/** One row of opencode's `message` table, as the settlement rules read it. */
export type OpencodeTableRow = SqliteTableRow;

/**
 * The settlement of one decode of opencode's database, from the state a previous decode saved. The first read of a
 * database goes by row id, one pass over the table; a continuing one reads the rows changed after the newest change
 * the previous read saw.
 */
export function createOpencodeSettlement(
  path: string,
  options: { readonly state?: unknown; readonly final: boolean }
): SqliteSettlement {
  return createSqliteSettlement(opencodeMessageUsage, { path, ...options });
}

/** The cursor state of a legacy session directory: the last file name read. */
const legacyCursorState = z.looseObject({ after: lenient(z.string()) });

/** The database's source when it exists; otherwise each session directory of the older JSON layout, and a missing home is a `RootMissing` failure. */
async function listSources(
  platform: UsagePlatform,
  home: AgentHome,
  signal: AbortSignal | undefined
): Promise<(UsageSource | UsageSourceFailure)[]> {
  const source = await sqliteMessageSource(platform, AGENT, opencodeDatabasePath(home), OPENCODE_WAL_SUFFIX);
  if (source !== undefined) {
    return [source];
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
  return decodeSqliteMessages(opencodeMessageUsage, {
    agent: AGENT,
    platform,
    path,
    walSuffix: OPENCODE_WAL_SUFFIX,
    options
  });
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
  usageKey: usageWindowKey,
  sources(platform, home, options = {}) {
    return yieldUsageSources(AGENT, home.path, () => listSources(platform, home, options.signal), options);
  },
  decode(platform, target, options = {}) {
    return target.path.endsWith(OPENCODE_DATABASE_SUFFIX)
      ? decodeDatabase(platform, target.path, options)
      : decodeLegacySession(platform, target.path, options);
  }
};
