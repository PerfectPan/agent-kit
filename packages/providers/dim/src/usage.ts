import * as z from "zod/mini";
import {
  applyUsageRecordMeta,
  decodeSqliteAppendLog,
  lenient,
  sqliteHomeSources,
  yieldUsageSources,
  type DecodeUsageOptions,
  type SqliteAppendRow,
  type UsageDecoder,
  type UsagePlatform,
  type UsageRecord,
  type UsageStream,
  usageWindowKey
} from "@rivus/agent-kit-sessions/spi";
import { DIM_DATABASE, DIM_HOME, DIM_ID, DIM_WAL_SUFFIX } from "./facts.js";
import { dimDatabasePath } from "./layout.js";
import { dimLedgerUsage } from "./records.js";

// The v2 database's `usage_ledger` is insert-only: one row per settled usage event, columns ledgerId, sessionId,
// runId, providerId, modelId, usage (JSON), cost (USD as REAL) and createdAt (ISO text). The row id cursor of
// `decodeSqliteAppendLog` follows the inserts. `usage_run_stats` upserts the same totals per run and is not read.

/** The ids and cost beside a row's usage JSON, from the row's own columns. */
const DimLedgerRow = z.looseObject({
  runId: lenient(z.optional(z.string())),
  providerId: lenient(z.optional(z.string())),
  modelId: lenient(z.optional(z.string())),
  cost: lenient(z.optional(z.number()))
});

function numberOrUndefined(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/**
 * The usage of one appended ledger row: one settled usage event of one run, `turn` granularity. The row's JSON is
 * the usage; the run, model, provider and cost live in the row's columns. A row with no token counts is skipped.
 */
export function dimLedgerRecord(value: unknown, row: SqliteAppendRow): UsageRecord | undefined {
  // The row's `usage` column is the JSON the transcript's request events read; both sides use one rule.
  const usage = dimLedgerUsage(typeof value === "string" ? value : JSON.stringify(value));
  if (!usage) {
    return undefined;
  }
  const meta = z.safeParse(DimLedgerRow, { ...row.raw, cost: numberOrUndefined(row.raw.cost) }).data;
  const record: UsageRecord = {
    agent: DIM_ID,
    sessionId: row.sessionId ?? "unknown",
    granularity: "turn",
    // One settled usage event per ledger row: the row is the identity, the run stays as the response id.
    requestId: row.id,
    timestamp: row.created,
    usage,
    source: row.source
  };
  return applyUsageRecordMeta(record, {
    model: meta?.modelId,
    provider: meta?.providerId,
    cost: meta?.cost
  });
}

/** The ledger rows of the database, in insert order, through the agent's row rules. */
function decodeDatabase(platform: UsagePlatform, path: string, options: DecodeUsageOptions): UsageStream {
  return decodeSqliteAppendLog(dimLedgerRecord, {
    agent: DIM_ID,
    platform,
    path,
    walSuffix: DIM_WAL_SUFFIX,
    columns: {
      table: "usage_ledger",
      id: "ledgerId",
      sessionId: "sessionId",
      created: "createdAt",
      data: "usage",
      extras: ["runId", "providerId", "modelId", "cost"]
    },
    options
  });
}

/** The sessions database `<home>/dimcode.sqlite`, which needs `platform.sqlite`. */
export const dimUsageDecoder: UsageDecoder = {
  specificationVersion: "usage-v1",
  agent: DIM_ID,
  home: DIM_HOME,
  usageKey: usageWindowKey,
  sources(platform, home, options = {}) {
    return yieldUsageSources(
      DIM_ID,
      home.path,
      () => sqliteHomeSources(platform, DIM_ID, home.path, dimDatabasePath(home), DIM_WAL_SUFFIX),
      options
    );
  },
  decode(platform, target, options = {}) {
    return decodeDatabase(platform, target.path, options);
  }
};

/** The database below the home, as facts name it; exported for the tests' fixtures. */
export const dimDatabaseFile: string = DIM_DATABASE;
