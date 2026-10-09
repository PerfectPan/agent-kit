import * as z from "zod/mini";

import type { SourcePointer } from "../../../transcript/index.js";
import { compactUsage, type Usage, type UsageRecord } from "../../index.js";
import { lenient } from "../../../transcript/adapters/lenient.js";

const AGENT = "opencode";

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
export function opencodeUsageKey(record: UsageRecord): string | undefined {
  return record.requestId === undefined ? undefined : `${record.sessionId} ${record.requestId}`;
}
