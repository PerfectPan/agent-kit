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
  sqliteMessageSource,
  sqliteQueryFloor,
  type DecodeUsageOptions,
  type ReadFailed,
  type SqliteMessageRow,
  type SqliteSettlement,
  type SqliteTableRow,
  type Usage,
  type UsageDecoder,
  type UsagePlatform,
  type UsageRecord,
  type UsageSource,
  type UsageSourceFailure,
  type UsageStream
} from "@rivus/agent-kit-sessions/spi";
import {
  OPENCODE_ID as AGENT,
  OPENCODE_MESSAGE_SUFFIX,
  OPENCODE_DATABASE_SUFFIX,
  OPENCODE_WAL_SUFFIX
} from "./facts.js";
import { opencodeDatabasePath, opencodeLegacyMessageRoot } from "./layout.js";

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
export function opencodeMessageUsage(value: unknown, row: SqliteMessageRow): UsageRecord | "running" | undefined {
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

/** The `ReadFailed` a decode yields for an error the platform did not classify: the thrown value's message, kept for the report. */
function readFailed(path: string, cause: unknown): ReadFailed {
  return { _tag: "ReadFailed", path, message: cause instanceof Error ? cause.message : String(cause), cause };
}

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
