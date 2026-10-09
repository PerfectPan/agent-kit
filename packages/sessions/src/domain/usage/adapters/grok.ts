import { err, ok } from "@rivus/agent-kit-catalog";
import * as z from "zod/mini";

import { sourceOf, timeOf, unknownFormatGeneration } from "../../transcript/index.js";
import { compactUsage, type ModelUsage, type Usage, type UsageRecord } from "../index.js";
import { lenient } from "../../transcript/adapters/lenient.js";
import { type AcpUpdateValue, acpUpdateOf } from "../../transcript/adapters/acp-updates.js";
import { grokMetaOf } from "../../transcript/adapters/grok/chunks.js";
import type { UsageFile, UsageLineDecoder } from "./usage-lines.js";

const AGENT = "grok";

/** One model's share of a turn summary. `modelCalls` is how many model calls this share covers. */
export interface GrokModelUsage {
  usage: Usage;
  modelCalls?: number;
}

/** The counts Grok logs for a turn or for one model's share of it; `costUsdTicks` prices the share. */
export interface GrokCountsValue {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  cachedReadTokens?: number;
  cacheCreationTokens?: number;
  reasoningTokens?: number;
  modelCalls?: number;
  costUsdTicks?: number;
}

/** Usage of a `turn_completed.usage` object: the turn's counts plus the per-model split. */
export interface GrokTurnUsageValue extends GrokCountsValue {
  modelUsage?: Record<string, GrokCountsValue | undefined>;
}

const GrokCounts = z.looseObject({
  inputTokens: lenient(z.number()),
  outputTokens: lenient(z.number()),
  totalTokens: lenient(z.number()),
  cachedReadTokens: lenient(z.number()),
  cacheCreationTokens: lenient(z.number()),
  reasoningTokens: lenient(z.number()),
  modelCalls: lenient(z.number()),
  costUsdTicks: lenient(z.number())
});

const GrokTurnUsage = z.extend(GrokCounts, {
  modelUsage: lenient(z.record(z.string(), lenient(GrokCounts)))
});

/**
 * Usage of a `turn_completed.usage` object, or of one `modelUsage` entry. Grok's `inputTokens` already includes
 * cached input (`cachedReadTokens` ≤ `inputTokens`), so cache counts stay subsets and are not added again.
 */
export function grokUsage(value: unknown): Usage | undefined {
  return grokUsageOf(z.safeParse(GrokCounts, value).data);
}

/** The Usage of Grok counts this module's schemas parsed; absent when no count is present. */
export function grokUsageOf(counts: GrokCountsValue | undefined): Usage | undefined {
  if (!counts) {
    return undefined;
  }
  return compactUsage({
    inputTokens: counts.inputTokens,
    outputTokens: counts.outputTokens,
    totalTokens: counts.totalTokens,
    cacheReadTokens: counts.cachedReadTokens,
    cacheWriteTokens: counts.cacheCreationTokens,
    reasoningTokens: counts.reasoningTokens
  });
}

/** The parsed `turn_completed.usage` of an update, or `undefined` when it is not a record. */
export function grokTurnUsage(update: GrokUpdateValue): GrokTurnUsageValue | undefined {
  return z.safeParse(GrokTurnUsage, update.usage).data ?? undefined;
}

/** Per-model detail of a turn summary. Entries with no token counts are left out. */
export function grokUsageByModel(value: unknown): Record<string, GrokModelUsage> | undefined {
  const models = z.safeParse(z.record(z.string(), lenient(GrokCounts)), value).data;
  if (!models) {
    return undefined;
  }
  const out: Record<string, GrokModelUsage> = {};
  for (const [model, counts] of Object.entries(models)) {
    if (!counts) {
      continue;
    }
    const usage = grokUsageOf(counts);
    if (!usage) {
      continue;
    }
    const detail: GrokModelUsage = { usage };
    if (counts.modelCalls !== undefined) {
      detail.modelCalls = counts.modelCalls;
    }
    out[model] = detail;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * Dollars of a `costUsdTicks` count. The Grok CLI user guide (the `grok usage` subcommand and the headless JSON output)
 * defines the unit as 10^10 ticks per USD: `total_cost_usd_ticks` 126890500 is `total_cost_usd` 0.01268905.
 */
export function grokCostUsd(ticks: unknown): number | undefined {
  const count = z.safeParse(lenient(z.number()), ticks).data;
  return count === undefined ? undefined : count / 1e10;
}

/** One hook run of a `hook_execution`, as the event reports it. */
export interface GrokHookRunValue {
  name?: string;
  exit_code?: number;
  output?: string;
  status?: {
    status?: string;
    elapsed_ms?: number;
    exit_code?: number;
    output?: string;
  };
}

const GrokHookRun = z.looseObject({
  name: lenient(z.string()),
  exit_code: lenient(z.number()),
  output: lenient(z.string()),
  status: lenient(
    z.looseObject({
      status: lenient(z.string()),
      elapsed_ms: lenient(z.number()),
      exit_code: lenient(z.number()),
      output: lenient(z.string())
    })
  )
});

/**
 * The fields Grok adds to a recorded `session/update`, as this module's readers read them. `usage` and `_meta`
 * stay on the record, for the usage schemas above and `grokMetaOf` to parse per reader.
 */
export interface GrokFieldsValue {
  formatVersion?: unknown;
  schema_version?: number;
  prompt_id?: string;
  elapsed_ms?: number;
  stop_reason?: string;
  event_name?: string;
  tool_name?: string;
  runs?: (GrokHookRunValue | undefined)[];
  tokens_before?: number;
  tokens_used?: number;
  tokens_after?: number;
  subagent_id?: string;
  child_session_id?: string;
  duration_ms?: number;
  description?: string;
  phase?: string;
}

/** A recorded `session/update` of a generation this adapter reads. */
export interface GrokUpdateValue extends AcpUpdateValue, GrokFieldsValue {}

/** The fields Grok adds to a recorded update; a field of an unexpected type counts as absent. */
const GrokUpdateFields = z.looseObject({
  formatVersion: z.optional(z.unknown()),
  schema_version: lenient(z.number()),
  prompt_id: lenient(z.string()),
  elapsed_ms: lenient(z.number()),
  stop_reason: lenient(z.string()),
  event_name: lenient(z.string()),
  tool_name: lenient(z.string()),
  runs: lenient(z.array(lenient(GrokHookRun))),
  tokens_before: lenient(z.number()),
  tokens_used: lenient(z.number()),
  tokens_after: lenient(z.number()),
  subagent_id: lenient(z.string()),
  child_session_id: lenient(z.string()),
  duration_ms: lenient(z.number()),
  description: lenient(z.string()),
  phase: lenient(z.string())
});

/** A record of `updates.jsonl`: the update under `params` or on the record, with the record's timestamp. */
const GrokRecordedUpdate = z.looseObject({
  formatVersion: z.optional(z.unknown()),
  timestamp: lenient(z.union([z.number(), z.string()])),
  params: lenient(z.looseObject({ update: lenient(GrokUpdateFields) })),
  update: lenient(GrokUpdateFields)
});

/** A record parsed for its readers: the update body and the record's timestamp. */
interface GrokKnownRecord {
  readonly update: GrokUpdateValue;
  readonly timestamp?: number | string;
}

/**
 * A record of a format generation this adapter reads, split for its readers. JSON has no `undefined` value, so a
 * present `formatVersion` is a non-undefined one; `schema_version` counts only when it is a number, and another
 * number than 1 is an unknown generation.
 */
function parseKnownGrokUpdate(value: unknown): GrokKnownRecord | undefined {
  const record = z.safeParse(GrokRecordedUpdate, value).data;
  const grok = record?.params?.update ?? record?.update;
  const acp = acpUpdateOf(value);
  if (!acp || !grok || record?.formatVersion !== undefined || grok.formatVersion !== undefined) {
    return undefined;
  }
  const schemaVersion = grok.schema_version;
  if (schemaVersion !== undefined && schemaVersion !== 1) {
    return undefined;
  }
  // The shared reader parses the ACP fields of the body, the record schema the Grok fields. The merge copies the
  // parsed Grok fields one by one, so no raw pass-through field of either parse can pose as a parsed one; the
  // `satisfies` fails when the record schema grows a field this copy does not carry.
  const fields = {
    formatVersion: grok.formatVersion,
    schema_version: grok.schema_version,
    prompt_id: grok.prompt_id,
    elapsed_ms: grok.elapsed_ms,
    stop_reason: grok.stop_reason,
    event_name: grok.event_name,
    tool_name: grok.tool_name,
    runs: grok.runs,
    tokens_before: grok.tokens_before,
    tokens_used: grok.tokens_used,
    tokens_after: grok.tokens_after,
    subagent_id: grok.subagent_id,
    child_session_id: grok.child_session_id,
    duration_ms: grok.duration_ms,
    description: grok.description,
    phase: grok.phase
  } satisfies Record<keyof GrokFieldsValue, unknown>;
  return { update: Object.assign(acp, fields), timestamp: record?.timestamp };
}

/**
 * The `session/update` body of a record from a format generation this adapter reads: no `formatVersion` on the
 * record or the update, and a `schema_version` of 1 when the update names one.
 */
export function knownGrokUpdate(value: unknown): GrokUpdateValue | undefined {
  return parseKnownGrokUpdate(value)?.update;
}

/** The prompt the current update belongs to, and the model its turn named so far. */
export interface GrokTurn {
  prompt?: string;
  model?: string;
}

/**
 * Follows `_meta.promptIndex` and `_meta.modelId` through the updates. A new prompt forgets the previous turn's
 * model, and so does `turn_completed`, whose handler deletes `model`: a later turn must not inherit it.
 */
export function followGrokTurn(turn: GrokTurn, update: GrokUpdateValue): void {
  const meta = grokMetaOf(update._meta);
  const promptIndex = meta?.promptIndex;
  if (promptIndex !== undefined) {
    const prompt = String(promptIndex);
    if (prompt !== turn.prompt) {
      delete turn.model;
    }
    turn.prompt = prompt;
  }
  const model = meta?.modelId;
  if (model) {
    turn.model = model;
  }
}

/** A completed turn's model: the one its updates named, else the only model of its `modelUsage`. */
export function grokTurnModel(update: GrokUpdateValue, turnModel: string | undefined): string | undefined {
  const models = Object.keys(grokTurnUsage(update)?.modelUsage ?? {});
  return turnModel ?? (models.length === 1 ? models[0] : undefined);
}

interface GrokUsageState {
  turn: GrokTurn;
  lastTime?: number;
}

/**
 * Grok's usage over one session's `updates.jsonl`. Grok records usage only per turn (`turn_completed.usage` sums the
 * turn's model calls, including subagents that finished within it), so each record has `granularity: "turn"`,
 * `modelCalls` and the per-model split, and keeps the cost Grok logged as `costUsd` with `costSource: "agent"`. The
 * turn's `prompt_id` is its request id.
 */
export function grokUsageLines(file: UsageFile, saved?: unknown): UsageLineDecoder {
  const state = restore(saved);
  return {
    push(record) {
      const known = parseKnownGrokUpdate(record.value);
      if (!known) {
        return err(unknownFormatGeneration(AGENT, record));
      }
      const { update } = known;
      const ts = timeOf(known.timestamp) ?? state.lastTime ?? file.mtimeMs;
      state.lastTime = ts;
      followGrokTurn(state.turn, update);
      if (update.sessionUpdate !== "turn_completed") {
        return ok([]);
      }
      const model = grokTurnModel(update, state.turn.model);
      delete state.turn.model;
      const raw = grokTurnUsage(update);
      const usage = grokUsageOf(raw);
      if (!usage) {
        return ok([]);
      }
      const turn: UsageRecord = {
        agent: AGENT,
        sessionId: file.sessionId,
        granularity: "turn",
        timestamp: ts,
        usage,
        source: sourceOf(record)
      };
      const promptId = update.prompt_id;
      if (promptId) {
        turn.requestId = promptId;
      }
      const modelCalls = raw?.modelCalls;
      if (modelCalls !== undefined) {
        turn.modelCalls = modelCalls;
      }
      if (model) {
        turn.model = model;
      }
      const byModel = modelUsageWithCost(raw?.modelUsage);
      if (byModel) {
        turn.usageByModel = byModel;
      }
      const costUsd = grokCostUsd(raw?.costUsdTicks);
      if (costUsd !== undefined) {
        turn.costUsd = costUsd;
        turn.costSource = "agent";
      }
      return ok([turn]);
    },
    end() {
      return [];
    },
    save() {
      return structuredClone(state);
    }
  };
}

/** Per-model detail with the cost each model's ticks price; entries with no token counts are left out. */
function modelUsageWithCost(value: unknown): Record<string, ModelUsage> | undefined {
  const entries = z.safeParse(z.record(z.string(), lenient(GrokCounts)), value).data;
  if (!entries) {
    return undefined;
  }
  const out: Record<string, ModelUsage> = {};
  for (const [model, counts] of Object.entries(entries)) {
    if (!counts) {
      continue;
    }
    const usage = grokUsageOf(counts);
    if (!usage) {
      continue;
    }
    const detail: ModelUsage = { usage };
    if (counts.modelCalls !== undefined) {
      detail.modelCalls = counts.modelCalls;
    }
    const costUsd = grokCostUsd(counts.costUsdTicks);
    out[model] = costUsd === undefined ? detail : { ...detail, costUsd, costSource: "agent" };
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/** The state a cursor carries back, reading only the fields it understands. */
const GrokSavedState = z.looseObject({
  turn: lenient(z.looseObject({ prompt: lenient(z.string()), model: lenient(z.string()) })),
  lastTime: lenient(z.number())
});

/** A saved state is the decoder's own output, passed back through a cursor; a missing field starts empty. */
function restore(saved: unknown): GrokUsageState {
  const state = z.safeParse(GrokSavedState, saved).data;
  const turn = state?.turn;
  return {
    turn: {
      ...(turn?.prompt === undefined ? {} : { prompt: turn.prompt }),
      ...(turn?.model === undefined ? {} : { model: turn.model })
    },
    ...(state?.lastTime === undefined ? {} : { lastTime: state.lastTime })
  };
}

/** The key under which a scan counts a record once in its window: the session and the turn's prompt id. */
export function grokUsageKey(record: UsageRecord): string | undefined {
  return record.requestId === undefined ? undefined : `${record.sessionId} ${record.requestId}`;
}
