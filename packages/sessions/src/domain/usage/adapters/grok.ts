import { err, ok } from "@rivus/agent-kit-catalog";
import * as z from "zod/mini";

import { sourceOf, timeOf, unknownFormatGeneration } from "../../transcript/index.js";
import { compactUsage, type ModelUsage, type Usage, type UsageRecord } from "../index.js";
import { lenient } from "../../transcript/adapters/lenient.js";
import { logTimestamp } from "../../transcript/adapters/timestamp.js";
import type { AcpUpdateField, AcpUpdateValue } from "../../transcript/adapters/acp-updates.js";
import type { UsageFile, UsageLineDecoder } from "./usage-lines.js";

const AGENT = "grok";

/** Grok's per-update metadata: the turn's prompt index, its model, and whether the host hides the chunk. */
export interface GrokMetaValue {
  promptIndex?: number;
  modelId?: string;
  hideFromScrollback?: boolean;
}

const GrokMeta = z.looseObject({
  promptIndex: lenient(z.number()),
  modelId: lenient(z.string()),
  hideFromScrollback: lenient(z.boolean())
});

/** `_meta` parsed; a `null` or non-record metadata reads as absent. The preview's records are not schema-parsed. */
export function grokMetaOf(meta: unknown): GrokMetaValue | undefined {
  return z.safeParse(GrokMeta, meta).data ?? undefined;
}

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
export function grokUsageByModel(
  modelUsage: GrokTurnUsageValue["modelUsage"]
): Record<string, GrokModelUsage> | undefined {
  if (!modelUsage) {
    return undefined;
  }
  const out: Record<string, GrokModelUsage> = {};
  for (const [model, counts] of Object.entries(modelUsage)) {
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
 * defines the unit as 10^10 ticks per USD: `total_cost_usd_ticks` 126890500 is `total_cost_usd` 0.01268905. The count
 * arrives parsed, so the price is one division.
 */
export function grokCostUsd(ticks: number | undefined): number | undefined {
  return ticks === undefined ? undefined : ticks / 1e10;
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
 * The fields Grok adds to a recorded `session/update`, as this module's readers read them. `usage` stays on the
 * record, for `grokTurnUsage` to parse where a turn completes.
 */
export interface GrokFieldsValue {
  _meta?: GrokMetaValue;
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

/**
 * The body of one recorded update, parsed in one pass: the shared `session/update` fields, kept in sync with
 * `AcpUpdate` (../../transcript/adapters/acp-updates.ts, whose test reads the same fields through both readers),
 * then the fields Grok adds. The assertion below holds this schema to exactly the fields `GrokUpdateValue` names —
 * `AcpUpdateField` plus `GrokFieldsValue` — in both directions, so the parsed value cannot carry an undeclared
 * field and the value cannot declare one the schema drops. The schemas stay module-private: an exported
 * declaration typed by zod drags zod's declarations into the dts of the entries that bundle this module, and those
 * must import nothing.
 */
const GrokUpdateFields = z.looseObject({
  sessionUpdate: lenient(z.string()),
  content: lenient(z.unknown()),
  messageId: lenient(z.string()),
  toolCallId: lenient(z.string()),
  title: lenient(z.string()),
  toolName: lenient(z.string()),
  rawInput: lenient(z.unknown()),
  rawOutput: lenient(z.unknown()),
  status: lenient(z.string()),
  _meta: lenient(GrokMeta),
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

// The schema's parsed fields and the fields `GrokUpdateValue` declares must be the same set, in both directions: a
// field the schema parses without a declaration, and a declaration the schema no longer parses, both fail this
// assertion and stop the build. The value is read below so the check counts as used.
type _Shape = keyof typeof GrokUpdateFields.shape;
type _Declared = AcpUpdateField | keyof GrokFieldsValue;
const _schemaFieldsDeclared: [_Shape] extends [_Declared] ? ([_Declared] extends [_Shape] ? true : never) : never =
  true;
void _schemaFieldsDeclared;

/** A record of `updates.jsonl`: the update under `params` or on the record, with the record's timestamp. */
const GrokRecordedUpdate = z.looseObject({
  formatVersion: z.optional(z.unknown()),
  timestamp: logTimestamp,
  params: lenient(z.looseObject({ update: lenient(GrokUpdateFields) })),
  update: lenient(GrokUpdateFields)
});

/** Whether a parsed record names a format generation this adapter reads. */
function knownGeneration(
  update: { readonly formatVersion?: unknown; readonly schema_version?: number },
  record?: { readonly formatVersion?: unknown }
): boolean {
  // JSON has no `undefined` value, so a present `formatVersion` is a non-undefined one; `schema_version` counts only
  // when it is a number, and another number than 1 is an unknown generation.
  return (
    record?.formatVersion === undefined &&
    update.formatVersion === undefined &&
    (update.schema_version === undefined || update.schema_version === 1)
  );
}

/**
 * The `session/update` body of a record from a format generation this adapter reads: no `formatVersion` on the
 * record or the update, and a `schema_version` of 1 when the update names one.
 */
export function knownGrokUpdate(value: unknown): GrokUpdateValue | undefined {
  const record = z.safeParse(GrokRecordedUpdate, value).data;
  const update: GrokUpdateValue | undefined = record?.params?.update ?? record?.update;
  return update !== undefined && knownGeneration(update, record) ? update : undefined;
}

/** The update fields the turn follower reads; both the translation's and the usage path's schemas parse them. */
export interface GrokTurnUpdate {
  _meta?: GrokMetaValue;
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
export function followGrokTurn(turn: GrokTurn, update: GrokTurnUpdate): void {
  const promptIndex = update._meta?.promptIndex;
  if (promptIndex !== undefined) {
    const prompt = String(promptIndex);
    if (prompt !== turn.prompt) {
      delete turn.model;
    }
    turn.prompt = prompt;
  }
  const model = update._meta?.modelId;
  if (model) {
    turn.model = model;
  }
}

/** A completed turn's model: the one its updates named, else the only model of its `modelUsage`. */
export function grokTurnModel(
  modelUsage: GrokTurnUsageValue["modelUsage"],
  turnModel: string | undefined
): string | undefined {
  if (turnModel !== undefined || !modelUsage) {
    return turnModel;
  }
  const models = Object.keys(modelUsage);
  return models.length === 1 ? models[0] : undefined;
}

interface GrokUsageState {
  turn: GrokTurn;
  lastTime?: number;
}

/**
 * The fields of a recorded update the usage decoder reads. It runs per record over whole sessions, so unlike the
 * translation's `GrokUpdateFields` it parses no content blocks and no tool fields.
 */
const GrokUsageUpdateFields = z.looseObject({
  sessionUpdate: lenient(z.string()),
  prompt_id: lenient(z.string()),
  formatVersion: z.optional(z.unknown()),
  schema_version: lenient(z.number()),
  _meta: lenient(GrokMeta),
  usage: lenient(GrokTurnUsage)
});

interface GrokUsageUpdateValue {
  sessionUpdate?: string;
  prompt_id?: string;
  formatVersion?: unknown;
  schema_version?: number;
  _meta?: GrokMetaValue;
  usage?: GrokTurnUsageValue;
}

/** The usage decoder's record envelope, around the slim body schema. */
const GrokUsageRecordedUpdate = z.looseObject({
  formatVersion: z.optional(z.unknown()),
  timestamp: logTimestamp,
  params: lenient(z.looseObject({ update: lenient(GrokUsageUpdateFields) })),
  update: lenient(GrokUsageUpdateFields)
});

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
      const parsed = z.safeParse(GrokUsageRecordedUpdate, record.value).data;
      const update: GrokUsageUpdateValue | undefined = parsed?.params?.update ?? parsed?.update;
      if (!update || !knownGeneration(update, parsed)) {
        return err(unknownFormatGeneration(AGENT, record));
      }
      const ts = timeOf(parsed?.timestamp) ?? state.lastTime ?? file.mtimeMs;
      state.lastTime = ts;
      followGrokTurn(state.turn, update);
      if (update.sessionUpdate !== "turn_completed") {
        return ok([]);
      }
      // The turn ends here even when its usage is absent (a cancelled turn): the model is forgotten before the
      // early return, or the saved cursor would hand it to the next turn.
      const raw = update.usage;
      const model = grokTurnModel(raw?.modelUsage, state.turn.model);
      delete state.turn.model;
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
function modelUsageWithCost(modelUsage: GrokTurnUsageValue["modelUsage"]): Record<string, ModelUsage> | undefined {
  const byModel = grokUsageByModel(modelUsage);
  if (!byModel) {
    return undefined;
  }
  const out: Record<string, ModelUsage> = {};
  for (const [model, detail] of Object.entries(byModel)) {
    const costUsd = grokCostUsd(modelUsage?.[model]?.costUsdTicks);
    out[model] = costUsd === undefined ? detail : { ...detail, costUsd, costSource: "agent" };
  }
  return out;
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
