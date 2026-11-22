import {
  SQLITE_LONGEST_MESSAGE_MS,
  SQLITE_RUNNING_IDS,
  compactUsage,
  createSqliteSettlement,
  decodeSqliteMessages,
  sqliteStoredMessageUsage,
  sqliteHomeSources,
  sqliteMessageTokensOf,
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
  usageWindowKey,
  type UsageStream
} from "@rivus/agent-kit-sessions/spi";
import { ZCODE_ID as AGENT, ZCODE_WAL_SUFFIX } from "./facts.js";
import { zcodeDatabasePath } from "./layout.js";

/**
 * ZCode normalizes every provider's usage into the AI SDK shape before storing (its CLI maps `inputTokens.total` to
 * the raw prompt count, which includes the cached part, and `outputTokens.total` to the completion count with the
 * reasoning part inside it), so `input` already includes the cache and `output` the reasoning, and `total` is
 * input + output wherever it is present. Treating `output` as including `reasoning` is an inference from that
 * mapping: no message on the verified install reports reasoning above 0.
 */
export const zcodeTokensOf: (value: unknown) => SqliteMessageTokens | undefined = sqliteMessageTokensOf;

/** The Usage of a stored message's parsed `tokens`, which already count the way the kit's Usage convention does. */
export function zcodeUsage(tokens: SqliteMessageTokens | undefined): Usage | undefined {
  return compactUsage({
    inputTokens: tokens?.input,
    outputTokens: tokens?.output,
    totalTokens: tokens?.total,
    cacheReadTokens: tokens?.cache?.read,
    cacheWriteTokens: tokens?.cache?.write,
    reasoningTokens: tokens?.reasoning
  });
}

/** The usage of one stored message; ZCode logs the message's cost, 0 on the verified install, kept as the agent's. */
export function zcodeMessageUsage(value: unknown, row: SqliteMessageRow): UsageRecord | "running" | undefined {
  return sqliteStoredMessageUsage(AGENT, value, row, { usageOf: zcodeUsage, messageIds: false });
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
  usageKey: usageWindowKey,
  sources(platform, home, options = {}) {
    return yieldUsageSources(
      AGENT,
      home.path,
      () => sqliteHomeSources(platform, AGENT, home.path, zcodeDatabasePath(home), ZCODE_WAL_SUFFIX),
      options
    );
  },
  decode(platform, target, options = {}) {
    return decodeDatabase(platform, target.path, options);
  }
};
