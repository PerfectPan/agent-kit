import { ok } from "@rivus/agent-kit-catalog";
import * as z from "zod/mini";

import { sourceOf, timeOf } from "../../transcript/index.js";
import { compactUsage, type Usage, type UsageRecord } from "../index.js";
import { lenient } from "../../transcript/adapters/lenient.js";
import type { UsageFile, UsageLineDecoder } from "./usage-lines.js";

const AGENT = "pi";

/**
 * The `usage` of an assistant message: Pi's counts, plus the `cost` Pi logged for it. Pi's `Usage` type counts `input`
 * without the cache (`totalTokens` is input + output + cacheRead + cacheWrite), so the cache is added back; `reasoning`
 * and `cacheWrite1h` are subsets of `output` and `cacheWrite`, present when the provider reports them.
 */
const PiMessageUsage = z.looseObject({
  input: lenient(z.number()),
  output: lenient(z.number()),
  cacheRead: lenient(z.number()),
  cacheWrite: lenient(z.number()),
  totalTokens: lenient(z.number()),
  cacheWrite1h: lenient(z.number()),
  reasoning: lenient(z.number()),
  cost: lenient(z.looseObject({ total: lenient(z.number()) }))
});

type PiMessageUsageValue = z.output<typeof PiMessageUsage>;

/** A session file record: a `session` header, or an entry whose message carries the counts. */
const PiRecord = z.looseObject({
  id: lenient(z.string()),
  type: lenient(z.string()),
  parentSession: lenient(z.string()),
  message: lenient(
    z.looseObject({
      role: lenient(z.string()),
      model: lenient(z.string()),
      provider: lenient(z.string()),
      responseId: lenient(z.string()),
      usage: lenient(PiMessageUsage)
    })
  )
});

/** The Usage of an assistant message's parsed `usage`, with the cache added back into the input. */
function piUsage(usage: PiMessageUsageValue | undefined): Usage | undefined {
  const input = usage?.input;
  const cacheRead = usage?.cacheRead;
  const cacheWrite = usage?.cacheWrite;
  return compactUsage({
    inputTokens: input === undefined ? undefined : input + (cacheRead ?? 0) + (cacheWrite ?? 0),
    outputTokens: usage?.output,
    totalTokens: usage?.totalTokens,
    cacheReadTokens: cacheRead,
    cacheWriteTokens: cacheWrite,
    cacheWrite1hTokens: usage?.cacheWrite1h,
    reasoningTokens: usage?.reasoning
  });
}

interface PiUsageState {
  sessionId?: string;
  /** The header time of a forked or branched session: earlier entries are the parent's copies. */
  forkTime?: number;
  lastTime?: number;
}

/** The state a cursor carries back, reading only the fields it understands. */
const PiSavedState = z.looseObject({
  sessionId: lenient(z.string()),
  forkTime: lenient(z.number()),
  lastTime: lenient(z.number())
});

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
      const rec = z.safeParse(PiRecord, record.value).data;
      if (!rec) {
        return ok([]);
      }
      const { message } = rec;
      const ts = timeOf(rec.timestamp) ?? timeOf(message?.timestamp) ?? state.lastTime ?? file.mtimeMs;
      state.lastTime = ts;
      if (rec.type === "session") {
        state.sessionId ??= rec.id;
        if (rec.parentSession !== undefined) {
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
      const { responseId, model, provider } = message;
      const entryId = rec.id;
      const cost = message.usage?.cost?.total;
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
  const state = z.safeParse(PiSavedState, saved).data;
  return {
    ...(state?.sessionId === undefined ? {} : { sessionId: state.sessionId }),
    ...(state?.forkTime === undefined ? {} : { forkTime: state.forkTime }),
    ...(state?.lastTime === undefined ? {} : { lastTime: state.lastTime })
  };
}

/** The key under which a scan counts a record once in its window: the session and the entry id, unique in its session (a provider's response id need not be unique: a local model server numbers them). */
export function piUsageKey(record: UsageRecord): string | undefined {
  return record.requestId === undefined ? undefined : `${record.sessionId} ${record.requestId}`;
}
