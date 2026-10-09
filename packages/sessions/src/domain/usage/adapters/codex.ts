import { err, ok } from "@rivus/agent-kit-catalog";
import * as z from "zod/mini";

import { sourceOf, timeOf, unknownFormatGeneration } from "../../transcript/index.js";
import { compactUsage, shortHash, type Usage, type UsageRecord } from "../index.js";
import { lenient } from "../../transcript/adapters/lenient.js";
import { logTimestamp } from "../../transcript/adapters/timestamp.js";
import {
  CodexEnvelopeSchema,
  codexTokenCounts,
  type KeysExact,
  knownCodexRecord
} from "../../transcript/adapters/codex/records.js";
import { rememberKey, type UsageFile, type UsageLineDecoder } from "./usage-lines.js";
import {
  endForkReplay,
  FORK_REPLAY_START,
  type ForkReplayState,
  stepForkReplay
} from "../../transcript/adapters/codex/fork-replay.js";

const AGENT = "codex";

/** The payload fields the usage rule reads, of whatever envelope carries them. */
interface CodexUsagePayload {
  type?: string;
  id?: string;
  session_id?: string;
  model?: string;
  turn_id?: string;
  response_id?: string;
  forked_from_id?: string;
  source?: { subagent?: { thread_spawn?: unknown } };
  usage?: Record<string, unknown>;
  /** A payload's own time, as a `session_meta` carries it for the fork replay rule. */
  timestamp?: number | string;
  info?: {
    total_token_usage?: unknown;
    last_token_usage?: unknown;
  };
  thread_settings?: { service_tier?: string };
}

/**
 * The payload fields the usage rule reads, with those the fork replay rule reads in the same pass. The decoder runs
 * over every record of every rollout, so it parses only these fields, not the whole payload. The totals stay the raw
 * values they were: the usage rule compares them by their JSON text.
 */
const CodexUsagePayloadSchema = z.looseObject({
  type: lenient(z.string()),
  id: lenient(z.string()),
  session_id: lenient(z.string()),
  model: lenient(z.string()),
  turn_id: lenient(z.string()),
  response_id: lenient(z.string()),
  forked_from_id: lenient(z.string()),
  source: lenient(z.looseObject({ subagent: lenient(z.looseObject({ thread_spawn: z.optional(z.unknown()) })) })),
  usage: lenient(z.record(z.string(), z.unknown())),
  timestamp: logTimestamp,
  info: lenient(
    z.looseObject({
      total_token_usage: z.optional(z.unknown()),
      last_token_usage: z.optional(z.unknown())
    })
  ),
  thread_settings: lenient(z.looseObject({ service_tier: lenient(z.string()) }))
});

const _codexUsagePayloadKeys: true = true satisfies KeysExact<typeof CodexUsagePayloadSchema.shape, CodexUsagePayload>;

/** Compiled: the decoder's payload schema names exactly the keys of its interface. */
export type CodexUsageKeysExact = [typeof _codexUsagePayloadKeys];

/**
 * One rollout record for the usage rule: the envelope every codex reader parses, and the payload fields above. One
 * parse takes only these fields, not the whole payload.
 */
const CodexUsageRecord = z.looseObject({ ...CodexEnvelopeSchema.shape, payload: lenient(CodexUsagePayloadSchema) });

/**
 * The Usage of one model call from a Codex usage object: `token_usage_record.usage` or
 * `token_count.info.last_token_usage`. `input_tokens` already includes cached input, so it is the input count as it is.
 */
export function codexUsage(value: unknown): Usage | undefined {
  const usage = codexTokenCounts(value);
  if (!usage) {
    return undefined;
  }
  return compactUsage({
    inputTokens: usage.input_tokens,
    outputTokens: usage.output_tokens,
    totalTokens: usage.total_tokens,
    cacheReadTokens: usage.cached_input_tokens,
    cacheWriteTokens: usage.cache_write_input_tokens,
    reasoningTokens: usage.reasoning_output_tokens
  });
}

const COUNT_KEYS = [
  "input_tokens",
  "cached_input_tokens",
  "cache_write_input_tokens",
  "output_tokens",
  "reasoning_output_tokens",
  "total_tokens"
] as const;

/**
 * The Usage of the model call between two cumulative `total_token_usage` objects, for a `token_count` that has no
 * `last_token_usage`: each count's increase, never below 0. A count that `total` does not report stays absent.
 */
export function codexUsageDelta(total: unknown, previous: unknown): Usage | undefined {
  const current = codexTokenCounts(total);
  if (!current) {
    return undefined;
  }
  const before = codexTokenCounts(previous);
  const delta: Record<string, number> = {};
  for (const key of COUNT_KEYS) {
    const value = current[key];
    if (value !== undefined) {
      delta[key] = Math.max(0, value - (before?.[key] ?? 0));
    }
  }
  return codexUsage(delta);
}

/** What reading usage keeps between the records of one rollout. */
export interface CodexUsageTracker {
  /** A `token_usage_record` was seen; from then on those records are the usage, and `token_count` is ignored. */
  usageRecords: boolean;
  /** The last cumulative `total_token_usage`, while `token_count` is the usage. */
  totals?: unknown;
}

/** The usage of one model call, or why a usage record does not count. */
export type CodexRecordUsage =
  | { readonly skip: string }
  | { readonly usage: Usage | undefined; readonly responseId?: string };

/**
 * The usage a record reports, `undefined` for a record that is not about usage. Usage comes from `token_usage_record`
 * from the first such record on, and from `token_count` before it (a file written partly by an older Codex), where
 * `last_token_usage` wins over the increase of the cumulative totals. A `token_count` without `info` or with the same
 * totals as the previous one is skipped, and so is a response id met before (`seen` answers and remembers) and a
 * forked rollout's replay of its parent's usage.
 */
export function codexRecordUsage(
  tracker: CodexUsageTracker,
  envelope: string,
  payload: CodexUsagePayload,
  replayed: boolean,
  seen: (responseId: string) => boolean
): CodexRecordUsage | undefined {
  if (envelope === "token_usage_record") {
    tracker.usageRecords = true;
    // From here on the totals are not read again.
    delete tracker.totals;
    const responseId = payload.response_id;
    if (responseId && seen(responseId)) {
      return { skip: "duplicate-usage" };
    }
    if (replayed) {
      return { skip: "fork-replay" };
    }
    return { usage: codexUsage(payload.usage), ...(responseId ? { responseId } : {}) };
  }
  if (envelope !== "event_msg" || payload.type !== "token_count") {
    return undefined;
  }
  const info = payload.info;
  const total = info?.total_token_usage;
  const previous = tracker.totals;
  const unchanged = total !== undefined && previous !== undefined && JSON.stringify(total) === JSON.stringify(previous);
  if (total !== undefined && !tracker.usageRecords) {
    tracker.totals = total;
  }
  if (replayed) {
    return { skip: "fork-replay" };
  }
  if (tracker.usageRecords) {
    return { skip: "other-usage-source" };
  }
  if (!info) {
    return { skip: "empty-usage" };
  }
  if (unchanged) {
    return { skip: "unchanged-usage" };
  }
  // The last call's usage reads as a record, as it always did: a non-record one falls back to the totals' increase.
  const last = codexTokenCounts(info.last_token_usage);
  return { usage: last ? codexUsage(last) : codexUsageDelta(total, previous) };
}

/**
 * The price factor of a Codex service tier, as presence and ccusage bill it: priority processing (`priority`, which
 * the CLI's configuration also calls `fast`) costs twice the standard rate. Any other tier is standard.
 */
export function codexPricingMultiplier(serviceTier: string | undefined): number | undefined {
  return serviceTier === "priority" || serviceTier === "fast" ? 2 : undefined;
}

interface CodexUsageState {
  sessionId?: string;
  model?: string;
  serviceTier?: string;
  lastTime?: number;
  fork: ForkReplayState;
  tracker: CodexUsageTracker;
  /** `shortHash`es of the last response ids met, newest last. */
  responses: string[];
  /** The first usage record of a fork, while the replay rule waits for the second one. */
  waiting?: UsageRecord;
}

/**
 * How many response ids the decoder remembers, in its cursor. The translator remembers every id of a rollout; a decoder
 * that streams keeps the last ones, so a duplicate further apart than this would count twice. The logs we have read
 * hold no duplicate at all.
 */
const RESPONSE_IDS = 8;

/**
 * Codex's usage over one rollout, by the translator's rules (`codexRecordUsage`, `stepForkReplay`): one record per
 * model call, with the model of the turn's `turn_context` and the price factor of the thread's service tier
 * (`thread_settings_applied`).
 */
export function codexUsageLines(file: UsageFile, saved?: unknown): UsageLineDecoder {
  const state = restore(saved);
  const seen = (responseId: string): boolean => {
    const hash = shortHash(responseId);
    if (state.responses.includes(hash)) {
      return true;
    }
    rememberKey(state.responses, hash, RESPONSE_IDS);
    return false;
  };
  const settle = (settled: boolean | undefined): UsageRecord[] => {
    const waiting = state.waiting;
    if (settled === undefined || !waiting) {
      return [];
    }
    delete state.waiting;
    return settled ? [] : [waiting];
  };
  return {
    push(record) {
      const rec = z.safeParse(CodexUsageRecord, record.value).data;
      if (!knownCodexRecord(rec)) {
        return err(unknownFormatGeneration(AGENT, record));
      }
      const ts = timeOf(rec.timestamp) ?? state.lastTime ?? file.mtimeMs;
      state.lastTime = ts;
      const payload = rec.payload ?? {};
      const step = stepForkReplay(state.fork, rec, payload, ts);
      state.fork = step.state;
      const out = settle(step.settled);
      const envelope = rec.type;
      if (envelope === undefined) {
        // An older rollout's header names the session; a `record_type` marker is bookkeeping.
        if (rec.record_type === undefined) {
          state.sessionId ??= rec.id;
        }
        return ok(out);
      }
      if (envelope === "session_meta") {
        state.sessionId ??= payload.id ?? payload.session_id;
      } else if (envelope === "turn_context") {
        state.model = payload.model ?? state.model;
      } else if (envelope === "event_msg" && payload.type === "thread_settings_applied") {
        // The settings in force from here on: a tier left out is the standard one.
        const tier = payload.thread_settings?.service_tier;
        if (tier === undefined) {
          delete state.serviceTier;
        } else {
          state.serviceTier = tier;
        }
      }
      const found = codexRecordUsage(state.tracker, envelope, payload, step.replayed === true, seen);
      if (!found || "skip" in found || !found.usage) {
        return ok(out);
      }
      const usage = callRecord(state, file, found.usage, ts, sourceOf(record), found.responseId);
      if (step.replayed === undefined) {
        state.waiting = usage;
        return ok(out);
      }
      return ok([...out, usage]);
    },
    end(final) {
      // A first usage record still waiting for the replay rule stays undecided, in the state, until the file is final.
      if (!final) {
        return [];
      }
      const end = endForkReplay(state.fork);
      state.fork = end.state;
      return settle(end.settled);
    },
    save() {
      return structuredClone(state);
    }
  };
}

function callRecord(
  state: CodexUsageState,
  file: UsageFile,
  usage: Usage,
  timestamp: number,
  source: UsageRecord["source"],
  responseId: string | undefined
): UsageRecord {
  const record: UsageRecord = {
    agent: AGENT,
    sessionId: state.sessionId ?? file.sessionId,
    granularity: "request",
    timestamp,
    usage,
    source
  };
  if (responseId) {
    record.responseId = responseId;
  }
  if (state.model) {
    record.model = state.model;
  }
  const multiplier = codexPricingMultiplier(state.serviceTier);
  if (multiplier !== undefined) {
    record.pricingMultiplier = multiplier;
  }
  return record;
}

/** The state a cursor carries back, read field by field: a field of an unexpected type counts as absent. */
const CodexSavedState = z.looseObject({
  sessionId: lenient(z.string()),
  model: lenient(z.string()),
  serviceTier: lenient(z.string()),
  lastTime: lenient(z.number()),
  fork: lenient(
    z.looseObject({
      phase: lenient(z.string()),
      forkTime: lenient(z.number()),
      second: lenient(z.number())
    })
  ),
  tracker: lenient(z.looseObject({ usageRecords: lenient(z.boolean()), totals: z.optional(z.unknown()) })),
  responses: lenient(z.array(lenient(z.string()))),
  waiting: z.optional(z.unknown())
});

/** A saved state is the decoder's own output, passed back through a cursor; a missing field starts empty. The state
 * is cloned first, so an emitted record and the caller's cursor never share an object. */
function restore(saved: unknown): CodexUsageState {
  const state = z.safeParse(CodexSavedState, structuredClone(saved)).data;
  return {
    ...(state?.sessionId === undefined ? {} : { sessionId: state.sessionId }),
    ...(state?.model === undefined ? {} : { model: state.model }),
    ...(state?.serviceTier === undefined ? {} : { serviceTier: state.serviceTier }),
    ...(state?.lastTime === undefined ? {} : { lastTime: state.lastTime }),
    ...(state?.waiting === undefined ? {} : { waiting: state.waiting as UsageRecord }),
    fork: state?.fork?.phase === undefined ? FORK_REPLAY_START : (state.fork as ForkReplayState),
    tracker: { ...state?.tracker, usageRecords: state?.tracker?.usageRecords === true },
    responses: state?.responses?.filter((id): id is string => id !== undefined) ?? []
  };
}

/**
 * The key under which a scan counts a model call once in its window. Codex records no id of its own for a call, and a
 * response id is unique only to its server (a local model server numbers them, `resp_<n>`), so the key is the session,
 * the time and the response id. A `token_count` has no response id and no key.
 */
export function codexUsageKey(record: UsageRecord): string | undefined {
  return record.responseId === undefined ? undefined : `${record.sessionId} ${record.timestamp} ${record.responseId}`;
}
