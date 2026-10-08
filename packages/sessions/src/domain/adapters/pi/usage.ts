import { ok } from "@rivus/agent-kit-catalog";

import { sourceOf, timeOf } from "../../transcript/index.js";
import { compactUsage, type Usage, type UsageRecord } from "../../usage/index.js";
import { asNumber, asRecord, asString } from "../../protocols/record-fields.js";
import type { UsageFile, UsageLineDecoder } from "../usage-lines.js";

const AGENT = "pi";

/**
 * The Usage of an assistant message's `usage`. Pi's `Usage` type counts `input` without the cache (`totalTokens` is
 * input + output + cacheRead + cacheWrite), so the cache is added back; `reasoning` and `cacheWrite1h` are subsets of
 * `output` and `cacheWrite`, present when the provider reports them.
 */
export function piUsage(value: unknown): Usage | undefined {
  const usage = asRecord(value);
  if (!usage) {
    return undefined;
  }
  const input = asNumber(usage.input);
  const cacheRead = asNumber(usage.cacheRead);
  const cacheWrite = asNumber(usage.cacheWrite);
  return compactUsage({
    inputTokens: input === undefined ? undefined : input + (cacheRead ?? 0) + (cacheWrite ?? 0),
    outputTokens: asNumber(usage.output),
    totalTokens: asNumber(usage.totalTokens),
    cacheReadTokens: cacheRead,
    cacheWriteTokens: cacheWrite,
    cacheWrite1hTokens: asNumber(usage.cacheWrite1h),
    reasoningTokens: asNumber(usage.reasoning)
  });
}

interface PiUsageState {
  sessionId?: string;
  /** The header time of a forked or branched session: earlier entries are the parent's copies. */
  forkTime?: number;
  lastTime?: number;
}

/**
 * Pi's usage over one session file: one record per assistant message with usage, with the cost Pi logged
 * (`usage.cost.total`, kept even when 0) as the agent's. The copied entries at the start of a forked or branched
 * session are the parent's, already counted in its file, and are skipped. The entry id, unique in its session, is the
 * request id.
 */
export function piUsageLines(file: UsageFile, saved?: unknown): UsageLineDecoder {
  const state = restore(saved);
  return {
    push(record) {
      const rec = asRecord(record.value);
      if (!rec) {
        return ok([]);
      }
      const message = asRecord(rec.message);
      const ts = timeOf(rec.timestamp) ?? timeOf(message?.timestamp) ?? state.lastTime ?? file.mtimeMs;
      state.lastTime = ts;
      if (rec.type === "session") {
        state.sessionId ??= asString(rec.id);
        if (typeof rec.parentSession === "string") {
          state.forkTime ??= timeOf(rec.timestamp);
        }
        return ok([]);
      }
      if (rec.type !== "message" || message?.role !== "assistant") {
        return ok([]);
      }
      const usage = piUsage(message.usage);
      if (!usage || (state.forkTime !== undefined && ts < state.forkTime)) {
        return ok([]);
      }
      const out: UsageRecord = {
        agent: AGENT,
        sessionId: state.sessionId ?? file.sessionId,
        granularity: "request",
        timestamp: ts,
        usage,
        source: sourceOf(record)
      };
      const model = asString(message.model);
      const provider = asString(message.provider);
      const entryId = asString(rec.id);
      const responseId = asString(message.responseId);
      const cost = asNumber(asRecord(asRecord(message.usage)?.cost)?.total);
      if (entryId) {
        out.requestId = entryId;
      }
      if (responseId) {
        out.responseId = responseId;
      }
      if (model) {
        out.model = model;
      }
      if (provider) {
        out.provider = provider;
      }
      if (cost !== undefined) {
        out.costUsd = cost;
        out.costSource = "agent";
      }
      return ok([out]);
    },
    end() {
      return [];
    },
    save() {
      return structuredClone(state);
    }
  };
}

/** A saved state is the decoder's own output, passed back through a cursor; a missing field starts empty. */
function restore(saved: unknown): PiUsageState {
  const state = asRecord(saved);
  const sessionId = asString(state?.sessionId);
  const forkTime = asNumber(state?.forkTime);
  const lastTime = asNumber(state?.lastTime);
  return {
    ...(sessionId === undefined ? {} : { sessionId }),
    ...(forkTime === undefined ? {} : { forkTime }),
    ...(lastTime === undefined ? {} : { lastTime })
  };
}

/** The key under which a scan counts a record once in its window: the session and the entry id, unique in its session (a provider's response id need not be unique: a local model server numbers them). */
export function piUsageKey(record: UsageRecord): string | undefined {
  return record.requestId === undefined ? undefined : `${record.sessionId} ${record.requestId}`;
}
