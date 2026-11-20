import { ok, type Result } from "@rivus/agent-kit-catalog/spi";
import * as z from "zod/mini";
import {
  decodeJsonlUsage,
  fileSources,
  lenient,
  rememberKey,
  sameFile,
  sourceOf,
  type JsonlUsageLayout,
  type SourcedRecord,
  type UnknownFormatGeneration,
  type UsageDecoder,
  type UsageFile,
  type UsageLineDecoder,
  type UsagePlatform,
  type UsageRecord
} from "@rivus/agent-kit-sessions/spi";
import { QODER_HOME, QODER_ID } from "./facts.js";
import { QODER_USAGE_FILES, qoderRoots, qoderUsageSourceId, qoderUsageTarget } from "./layout.js";
import { qoderRecordOf, qoderRecordTime, qoderUsageOf, qoderUsageSize } from "./records.js";

// Each `assistant` record in Qoder CLI's JSONL transcripts (`projects/<cwd>/<sessionId>.jsonl` and
// `projects/<cwd>/<sessionId>/subagents/agent-<id>.jsonl`) carries `message.usage` in the Anthropic/Claude Code
// shape (`input_tokens`, `output_tokens`, `cache_read_input_tokens`, `cache_creation_input_tokens`). Streamed
// fragments sharing the same `message.id` / `requestId` merge into one request record, keeping the largest usage.

const SavedUsage = z.looseObject({
  inputTokens: lenient(z.optional(z.number())),
  outputTokens: lenient(z.optional(z.number())),
  totalTokens: lenient(z.optional(z.number())),
  cacheReadTokens: lenient(z.optional(z.number())),
  cacheWriteTokens: lenient(z.optional(z.number())),
  cacheWrite1hTokens: lenient(z.optional(z.number())),
  reasoningTokens: lenient(z.optional(z.number()))
});

const SavedSource = z.looseObject({
  file: z.string(),
  offset: z.number(),
  length: z.number(),
  line: z.number()
});

const SavedOpenRecord = z.looseObject({
  agent: z.string(),
  sessionId: z.string(),
  agentLaneId: lenient(z.optional(z.string())),
  granularity: z.literal("request"),
  requestId: lenient(z.optional(z.string())),
  responseId: lenient(z.optional(z.string())),
  timestamp: z.number(),
  model: lenient(z.optional(z.string())),
  usage: SavedUsage,
  source: SavedSource
});

const SavedState = z.looseObject({
  lastTime: lenient(z.optional(z.number())),
  reported: lenient(z.optional(z.array(z.string()))),
  open: lenient(z.optional(z.record(z.string(), z.unknown())))
});

const REPORTED_LIMIT = 256;

interface QoderUsageState {
  lastTime?: number;
  reported: string[];
  open: Map<string, UsageRecord>;
}

function restoreState(saved: unknown): QoderUsageState {
  const parsed = z.safeParse(SavedState, saved).data;
  const open = new Map<string, UsageRecord>();
  for (const [key, raw] of Object.entries(parsed?.open ?? {})) {
    const rec = z.safeParse(SavedOpenRecord, raw).data;
    if (rec !== undefined) {
      open.set(key, rec);
    }
  }
  return {
    ...(parsed?.lastTime !== undefined ? { lastTime: parsed.lastTime } : {}),
    reported: [...(parsed?.reported ?? [])].slice(-REPORTED_LIMIT),
    open
  };
}

function mergeUsageRecord(existing: UsageRecord, incoming: UsageRecord): UsageRecord {
  const usage = qoderUsageSize(incoming.usage) >= qoderUsageSize(existing.usage) ? incoming.usage : existing.usage;
  return {
    ...existing,
    ...(incoming.model !== undefined ? { model: incoming.model } : {}),
    ...(incoming.requestId !== undefined ? { requestId: incoming.requestId } : {}),
    ...(incoming.responseId !== undefined ? { responseId: incoming.responseId } : {}),
    usage
  };
}

function qoderUsageKey(record: UsageRecord): string | undefined {
  const lane = record.agentLaneId ?? "";
  if (record.requestId !== undefined) {
    return `${record.sessionId} ${lane} req:${record.requestId}`;
  }
  if (record.responseId !== undefined) {
    return `${record.sessionId} ${lane} msg:${record.responseId}`;
  }
  return undefined;
}

function qoderUsageLines(file: UsageFile, saved?: unknown): UsageLineDecoder {
  const state = restoreState(saved);
  return {
    push(record: SourcedRecord): Result<UsageRecord[], UnknownFormatGeneration> {
      const parsed = qoderRecordOf(record.value);
      if (parsed === undefined) {
        return ok([]);
      }
      const recordTime = qoderRecordTime(parsed);
      if (recordTime !== undefined) {
        state.lastTime = recordTime;
      }
      if (parsed.type !== "assistant") {
        return ok([]);
      }
      const usage = qoderUsageOf(parsed.message?.usage);
      if (usage === undefined) {
        return ok([]);
      }
      const timestamp = recordTime ?? state.lastTime ?? file.mtimeMs;
      const agentLaneId = file.agentLaneId ?? (parsed.isSidechain ? parsed.agentId : undefined);
      const sessionId = parsed.sessionId ?? file.sessionId;
      const decoded: UsageRecord = {
        agent: QODER_ID,
        sessionId,
        granularity: "request",
        ...(parsed.requestId !== undefined ? { requestId: parsed.requestId } : {}),
        ...(parsed.message?.id !== undefined ? { responseId: parsed.message.id } : {}),
        ...(agentLaneId !== undefined ? { agentLaneId } : {}),
        timestamp,
        ...(parsed.message?.model !== undefined ? { model: parsed.message.model } : {}),
        usage,
        source: sourceOf(record)
      };
      const key = qoderUsageKey(decoded);
      if (key === undefined) {
        return ok([decoded]);
      }
      if (state.reported.includes(key)) {
        return ok([]);
      }
      const existing = state.open.get(key);
      if (existing !== undefined) {
        state.open.set(key, mergeUsageRecord(existing, decoded));
        return ok([]);
      }
      // Flush previously open keyed requests on the same lane when a new keyed request begins,
      // keeping incremental reads streaming without cutting off another lane's in-flight fragments.
      const lane = decoded.agentLaneId ?? "";
      const flushed: UsageRecord[] = [];
      for (const [openKey, openRecord] of state.open) {
        if ((openRecord.agentLaneId ?? "") !== lane) {
          continue;
        }
        flushed.push(openRecord);
        rememberKey(state.reported, openKey, REPORTED_LIMIT);
        state.open.delete(openKey);
      }
      state.open.set(key, decoded);
      return ok(flushed);
    },
    end(final) {
      if (!final) {
        return [];
      }
      const flushed: UsageRecord[] = [];
      for (const [openKey, openRecord] of state.open) {
        flushed.push(openRecord);
        rememberKey(state.reported, openKey, REPORTED_LIMIT);
      }
      state.open.clear();
      return flushed;
    },
    save() {
      return {
        ...(state.lastTime !== undefined ? { lastTime: state.lastTime } : {}),
        reported: [...state.reported],
        open: Object.fromEntries(state.open)
      };
    }
  };
}

const qoderUsageLayout: JsonlUsageLayout = {
  agent: QODER_ID,
  file: sameFile((path) => qoderUsageTarget(path) ?? { sessionId: "unknown" }),
  decoder: qoderUsageLines
};

export const qoderUsageDecoder: UsageDecoder = {
  specificationVersion: "usage-v1",
  agent: QODER_ID,
  home: QODER_HOME,
  usageKey: qoderUsageKey,
  sources(platform: UsagePlatform, home, options = {}) {
    return fileSources(platform, QODER_ID, qoderRoots(home), QODER_USAGE_FILES, {
      ...options,
      keep: (path) => qoderUsageTarget(path) !== undefined,
      identify: qoderUsageSourceId
    });
  },
  decode(platform, target, options) {
    return decodeJsonlUsage(platform, target, qoderUsageLayout, options);
  }
};
