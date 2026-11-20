import { ok, type Result } from "@rivus/agent-kit-catalog/spi";
import {
  decodeJsonlUsage,
  fileSources,
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
import { AGY_HOME, AGY_ID, AGY_TRANSCRIPT_REL } from "./facts.js";
import { agyRoots, agySessionIdFromPath, AGY_TRANSCRIPT_FILES } from "./layout.js";
import { agyRecordTime, agyStepOf, agyUsageOf } from "./records.js";

// Every `PLANNER_RESPONSE` (and `CHECKPOINT` compaction call) in `transcript.jsonl` carries per-step token counts
// (`input_tokens`, `cache_read_tokens`, `output_tokens`) and `model`, with `step_index` identifying the step within
// the conversation.

function agyUsageLines(file: UsageFile): UsageLineDecoder {
  return {
    push(record: SourcedRecord): Result<UsageRecord[], UnknownFormatGeneration> {
      const step = agyStepOf(record.value);
      if (step === undefined) {
        return ok([]);
      }
      const usage = agyUsageOf(step);
      if (usage === undefined) {
        return ok([]);
      }
      const timestamp = agyRecordTime(step) ?? file.mtimeMs;
      const requestId = step.step_index === undefined ? undefined : String(step.step_index);
      const decoded: UsageRecord = {
        agent: AGY_ID,
        sessionId: file.sessionId,
        granularity: "request",
        ...(requestId !== undefined ? { requestId } : {}),
        timestamp,
        ...(step.model !== undefined ? { model: step.model } : {}),
        usage,
        source: sourceOf(record)
      };
      return ok([decoded]);
    },
    end() {
      return [];
    },
    save() {
      return undefined;
    }
  };
}

const agyUsageLayout: JsonlUsageLayout = {
  agent: AGY_ID,
  file: sameFile((path) => ({ sessionId: agySessionIdFromPath(path) })),
  decoder: agyUsageLines
};

function agyUsageKey(record: UsageRecord): string {
  return record.requestId !== undefined
    ? `${record.sessionId} step:${record.requestId}`
    : `${record.sessionId} line:${record.source.line}`;
}

export const agyUsageDecoder: UsageDecoder = {
  specificationVersion: "usage-v1",
  agent: AGY_ID,
  home: AGY_HOME,
  usageKey: agyUsageKey,
  sources(platform: UsagePlatform, home, options = {}) {
    return fileSources(platform, AGY_ID, agyRoots(home), AGY_TRANSCRIPT_FILES, {
      ...options,
      keep: (path) => path.replaceAll("\\", "/").endsWith(`/${AGY_TRANSCRIPT_REL}`),
      identify: agySessionIdFromPath
    });
  },
  decode(platform, target, options) {
    return decodeJsonlUsage(platform, target, agyUsageLayout, options);
  }
};
