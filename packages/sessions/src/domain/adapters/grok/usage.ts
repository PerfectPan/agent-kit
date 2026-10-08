import { err, ok } from "@rivus/agent-kit-catalog";

import { sourceOf, timeOf, unknownFormatGeneration } from "../../transcript/index.js";
import { compactUsage, type ModelUsage, type Usage, type UsageRecord } from "../../usage/index.js";
import { asNumber, asRecord, asString } from "../../protocols/record-fields.js";
import type { UsageFile, UsageLineDecoder } from "../usage-lines.js";
import { acpUpdateOf } from "../../protocols/acp-updates.js";
import { GROK_META_KEY } from "./chunks.js";

const AGENT = "grok";

/** One model's share of a turn summary. `modelCalls` is how many model calls this share covers. */
export interface GrokModelUsage {
  usage: Usage;
  modelCalls?: number;
}

/**
 * Usage of a `turn_completed.usage` object, or of one `modelUsage` entry. Grok's `inputTokens` already includes
 * cached input (`cachedReadTokens` ≤ `inputTokens`), so cache counts stay subsets and are not added again.
 */
export function grokUsage(value: unknown): Usage | undefined {
  const raw = asRecord(value);
  if (!raw) {
    return undefined;
  }
  return compactUsage({
    inputTokens: asNumber(raw.inputTokens),
    outputTokens: asNumber(raw.outputTokens),
    totalTokens: asNumber(raw.totalTokens),
    cacheReadTokens: asNumber(raw.cachedReadTokens),
    cacheWriteTokens: asNumber(raw.cacheCreationTokens),
    reasoningTokens: asNumber(raw.reasoningTokens)
  });
}

/** Per-model detail of a turn summary. Entries with no token counts are left out. */
export function grokUsageByModel(value: unknown): Record<string, GrokModelUsage> | undefined {
  const models = asRecord(value);
  if (!models) {
    return undefined;
  }
  const out: Record<string, GrokModelUsage> = {};
  for (const [model, raw] of Object.entries(models)) {
    const usage = grokUsage(raw);
    if (!usage) {
      continue;
    }
    const detail: GrokModelUsage = { usage };
    const calls = asNumber(asRecord(raw)?.modelCalls);
    if (calls !== undefined) {
      detail.modelCalls = calls;
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
  const count = asNumber(ticks);
  return count === undefined ? undefined : count / 1e10;
}

/**
 * The `session/update` body of a record from a format generation this adapter reads: no `formatVersion` on the
 * record or the update, and a `schema_version` of 1 when the update names one.
 */
export function knownGrokUpdate(value: unknown): Record<string, unknown> | undefined {
  const rec = asRecord(value);
  const update = acpUpdateOf(value);
  if (!rec || !update || "formatVersion" in rec || "formatVersion" in update) {
    return undefined;
  }
  const schemaVersion = asNumber(update.schema_version);
  return schemaVersion === undefined || schemaVersion === 1 ? update : undefined;
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
export function followGrokTurn(turn: GrokTurn, update: Record<string, unknown>): void {
  const meta = asRecord(update[GROK_META_KEY]);
  const promptIndex = asNumber(meta?.promptIndex);
  if (promptIndex !== undefined) {
    const prompt = String(promptIndex);
    if (prompt !== turn.prompt) {
      delete turn.model;
    }
    turn.prompt = prompt;
  }
  const model = asString(meta?.modelId);
  if (model) {
    turn.model = model;
  }
}

/** A completed turn's model: the one its updates named, else the only model of its `modelUsage`. */
export function grokTurnModel(update: Record<string, unknown>, turnModel: string | undefined): string | undefined {
  const models = Object.keys(asRecord(asRecord(update.usage)?.modelUsage) ?? {});
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
      const update = knownGrokUpdate(record.value);
      if (!update) {
        return err(unknownFormatGeneration(AGENT, record));
      }
      const ts = timeOf(asRecord(record.value)?.timestamp) ?? state.lastTime ?? file.mtimeMs;
      state.lastTime = ts;
      followGrokTurn(state.turn, update);
      if (update.sessionUpdate !== "turn_completed") {
        return ok([]);
      }
      const model = grokTurnModel(update, state.turn.model);
      delete state.turn.model;
      const raw = asRecord(update.usage);
      const usage = grokUsage(raw);
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
      const promptId = asString(update.prompt_id);
      if (promptId) {
        turn.requestId = promptId;
      }
      const modelCalls = asNumber(raw?.modelCalls);
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

function modelUsageWithCost(value: unknown): Record<string, ModelUsage> | undefined {
  const byModel = grokUsageByModel(value);
  if (!byModel) {
    return undefined;
  }
  const raw = asRecord(value) ?? {};
  const out: Record<string, ModelUsage> = {};
  for (const [model, detail] of Object.entries(byModel)) {
    const costUsd = grokCostUsd(asRecord(raw[model])?.costUsdTicks);
    out[model] = costUsd === undefined ? detail : { ...detail, costUsd, costSource: "agent" };
  }
  return out;
}

/** A saved state is the decoder's own output, passed back through a cursor; a missing field starts empty. */
function restore(saved: unknown): GrokUsageState {
  const state = asRecord(saved);
  const turn = asRecord(state?.turn);
  const prompt = asString(turn?.prompt);
  const model = asString(turn?.model);
  const lastTime = asNumber(state?.lastTime);
  return {
    turn: { ...(prompt === undefined ? {} : { prompt }), ...(model === undefined ? {} : { model }) },
    ...(lastTime === undefined ? {} : { lastTime })
  };
}

/** The key under which a scan counts a record once in its window: the session and the turn's prompt id. */
export function grokUsageKey(record: UsageRecord): string | undefined {
  return record.requestId === undefined ? undefined : `${record.sessionId} ${record.requestId}`;
}
