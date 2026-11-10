import type { AgentHome } from "@rivus/agent-kit-catalog/spi";
import * as z from "zod/mini";
import {
  SQLITE_LONGEST_MESSAGE_MS,
  SQLITE_RUNNING_IDS,
  compactUsage,
  createSqliteSettlement,
  decodeSqliteMessages,
  lenient,
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
import { ZCODE_ID as AGENT, ZCODE_WAL_SUFFIX } from "./facts.js";
import { zcodeDatabasePath } from "./layout.js";

/**
 * The `tokens` of a stored message. ZCode normalizes every provider's usage into the AI SDK shape before storing
 * (its CLI maps `inputTokens.total` to the raw prompt count, which includes the cached part, and `outputTokens.total`
 * to the completion count with the reasoning part inside it), so `input` already includes the cache and `output` the
 * reasoning, and `total` is input + output wherever it is present. Treating `output` as including `reasoning` is an
 * inference from that mapping: no message on the verified install reports reasoning above 0.
 */
const ZcodeTokens = z.looseObject({
  input: lenient(z.number()),
  output: lenient(z.number()),
  reasoning: lenient(z.number()),
  total: lenient(z.number()),
  cache: lenient(z.looseObject({ read: lenient(z.number()), write: lenient(z.number()) }))
});

/** The `tokens` of a stored message, as the schema reads them; the schema itself stays module-private. */
export interface ZcodeTokensValue {
  input?: number;
  output?: number;
  reasoning?: number;
  total?: number;
  cache?: { read?: number; write?: number };
}

/** The parsed `tokens` of a stored message, or undefined when the field is absent or malformed. */
export function zcodeTokensOf(value: unknown): ZcodeTokensValue | undefined {
  return z.safeParse(ZcodeTokens, value).data;
}

/** The Usage of a stored message's parsed `tokens`, which already count the way the kit's Usage convention does. */
export function zcodeUsage(tokens: ZcodeTokensValue | undefined): Usage | undefined {
  return compactUsage({
    inputTokens: tokens?.input,
    outputTokens: tokens?.output,
    totalTokens: tokens?.total,
    cacheReadTokens: tokens?.cache?.read,
    cacheWriteTokens: tokens?.cache?.write,
    reasoningTokens: tokens?.reasoning
  });
}

/** A stored message and the fields its usage rules read. The message and session ids live in the row's columns. */
const ZcodeMessage = z.looseObject({
  role: lenient(z.string()),
  modelId: lenient(z.string()),
  providerId: lenient(z.string()),
  cost: lenient(z.number()),
  time: lenient(z.looseObject({ created: lenient(z.number()), completed: lenient(z.number()) })),
  tokens: lenient(ZcodeTokens)
});

/**
 * The usage of one stored message: `undefined` for a message that is not an assistant's or has no token counts, and
 * `running` for an assistant message that has not finished (ZCode sets `time.completed` when it ends), whose counts may
 * still grow. ZCode logs the message's cost — 0 on the verified install, whose coding plan bills outside the store —
 * which is kept as the agent's.
 */
export function zcodeMessageUsage(value: unknown, row: SqliteMessageRow): UsageRecord | "running" | undefined {
  const message = z.safeParse(ZcodeMessage, value).data;
  if (message?.role !== "assistant") {
    return undefined;
  }
  const timestamp =
    message.time?.completed ?? (row.settledAt === undefined ? undefined : (message.time?.created ?? row.settledAt));
  if (timestamp === undefined) {
    return "running";
  }
  const usage = zcodeUsage(message.tokens);
  if (!usage) {
    return undefined;
  }
  const id = row.id;
  const record: UsageRecord = {
    agent: AGENT,
    sessionId: row.sessionId ?? "unknown",
    granularity: "request",
    ...(id ? { requestId: id } : {}),
    timestamp,
    usage,
    source: row.source
  };
  const { modelId: model, providerId: provider, cost } = message;
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
function zcodeUsageKey(record: UsageRecord): string | undefined {
  return record.requestId === undefined ? undefined : `${record.sessionId} ${record.requestId}`;
}

/** A message runs far shorter than this, so a row created this long before `since` holds no record to keep. */
export const LONGEST_MESSAGE_MS: number = SQLITE_LONGEST_MESSAGE_MS;

/** How many running messages a cursor remembers; one that never finishes is dropped once newer ones push it out. */
export const RUNNING_IDS: number = SQLITE_RUNNING_IDS;

/** The `time_created` a query may start at: a day before `since`, since a message created before it can still end inside the window. */
export const zcodeQueryFloor: (since: number | undefined) => number = sqliteQueryFloor;

/** One row of ZCode's `message` table, as the settlement rules read it. */
export type ZcodeTableRow = SqliteTableRow;

/**
 * The settlement of one decode of ZCode's database, from the state a previous decode saved. The first read of a
 * database goes by row id, one pass over the table; a continuing one reads the rows changed after the newest change
 * the previous read saw.
 */
export function createZcodeSettlement(
  path: string,
  options: { readonly state?: unknown; readonly final: boolean }
): SqliteSettlement {
  return createSqliteSettlement(zcodeMessageUsage, { path, ...options });
}

/** The `ReadFailed` a decode yields for an error the platform did not classify: the thrown value's message, kept for the report. */
function readFailed(path: string, cause: unknown): ReadFailed {
  return { _tag: "ReadFailed", path, message: cause instanceof Error ? cause.message : String(cause), cause };
}

/** The database's source; a missing database is no source, and a missing home is a `RootMissing` failure. */
async function listSources(platform: UsagePlatform, home: AgentHome): Promise<(UsageSource | UsageSourceFailure)[]> {
  const source = await sqliteMessageSource(platform, AGENT, zcodeDatabasePath(home), ZCODE_WAL_SUFFIX);
  if (source !== undefined) {
    return [source];
  }
  const present = (await platform.fs.stat(home.path, { followSymlinks: true })) !== undefined;
  return present ? [] : [{ agent: AGENT, path: home.path, error: { _tag: "RootMissing", path: home.path } }];
}

/**
 * The finished assistant messages of the database, in the order they last changed, through the agent's settlement
 * rules: this decoder only pages the queries and feeds their rows to them. A running message is not reported yet: it
 * changes again when it finishes and is read then. A decode of a quiet database is final, so a message that never
 * finished counts at its creation time. The `model_usage` table is not read: it only covers messages of newer
 * versions, while every `message` row is one decode away.
 */
function decodeDatabase(platform: UsagePlatform, path: string, options: DecodeUsageOptions): UsageStream {
  return decodeSqliteMessages(zcodeMessageUsage, {
    agent: AGENT,
    platform,
    path,
    walSuffix: ZCODE_WAL_SUFFIX,
    options
  });
}

/** The sessions database `<home>/cli/db/db.sqlite`, which needs `platform.sqlite`. */
export const zcodeUsageDecoder: UsageDecoder = {
  specificationVersion: "usage-v1",
  agent: AGENT,
  usageKey: zcodeUsageKey,
  async *sources(platform, home, options = {}) {
    const { since, signal } = options;
    signal?.throwIfAborted();
    let found: (UsageSource | UsageSourceFailure)[];
    try {
      found = await listSources(platform, home);
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
    return decodeDatabase(platform, target.path, options);
  }
};
