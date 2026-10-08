import type { SourcePointer } from "../../transcript/index.js";
import { compactUsage, type Usage, type UsageRecord } from "../../usage/index.js";
import { asNumber, asRecord, asString } from "../../protocols/record-fields.js";

const AGENT = "opencode";

/**
 * The Usage of a stored message's `tokens`. opencode counts `input` without the cache and `output` without reasoning
 * (its `total` is the sum of all five counts), so both are added back.
 */
export function opencodeUsage(value: unknown): Usage | undefined {
  const tokens = asRecord(value);
  if (!tokens) {
    return undefined;
  }
  const cache = asRecord(tokens.cache);
  const input = asNumber(tokens.input);
  const output = asNumber(tokens.output);
  const reasoning = asNumber(tokens.reasoning);
  const cacheRead = asNumber(cache?.read);
  const cacheWrite = asNumber(cache?.write);
  return compactUsage({
    inputTokens: input === undefined ? undefined : input + (cacheRead ?? 0) + (cacheWrite ?? 0),
    outputTokens: output === undefined ? undefined : output + (reasoning ?? 0),
    totalTokens: asNumber(tokens.total),
    cacheReadTokens: cacheRead,
    cacheWriteTokens: cacheWrite,
    reasoningTokens: reasoning
  });
}

/** Where a stored message comes from, besides its JSON. */
export interface OpencodeMessageRow {
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

/**
 * The usage of one stored message: `undefined` for a message that is not an assistant's or has no token counts, and
 * `running` for an assistant message that has not finished (opencode sets `time.completed` when it ends, also on an
 * error or an abort), whose counts may still grow. opencode logs the message's cost, which is kept as the agent's.
 */
export function opencodeMessageUsage(value: unknown, row: OpencodeMessageRow): UsageRecord | "running" | undefined {
  const message = asRecord(value);
  if (message?.role !== "assistant") {
    return undefined;
  }
  const time = asRecord(message.time);
  const timestamp =
    asNumber(time?.completed) ?? (row.settledAt === undefined ? undefined : (asNumber(time?.created) ?? row.settledAt));
  if (timestamp === undefined) {
    return "running";
  }
  const usage = opencodeUsage(message.tokens);
  if (!usage) {
    return undefined;
  }
  const id = asString(message.id) ?? row.id;
  const record: UsageRecord = {
    agent: AGENT,
    sessionId: asString(message.sessionID) ?? row.sessionId ?? "unknown",
    granularity: "request",
    ...(id ? { requestId: id } : {}),
    timestamp,
    usage,
    source: row.source
  };
  const model = asString(message.modelID);
  const provider = asString(message.providerID);
  const cost = asNumber(message.cost);
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
export function opencodeUsageKey(record: UsageRecord): string | undefined {
  return record.requestId === undefined ? undefined : `${record.sessionId} ${record.requestId}`;
}
