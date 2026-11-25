import { definedFields, err, ok } from "@rivus/agent-kit-catalog/spi";
import type { Result } from "@rivus/agent-kit-catalog/spi";
import type {
  JsonlUsageLayout,
  SourcedRecord,
  UnknownFormatGeneration,
  UsageDecoder,
  UsageFile,
  UsageLineDecoder,
  UsagePlatform,
  UsageRecord
} from "@rivus/agent-kit-sessions/spi";
import { decodeJsonlUsage, fileSources, sameFile, sourceOf } from "@rivus/agent-kit-sessions/spi";
import { COPILOT_HOME, COPILOT_ID } from "./facts.js";
import { COPILOT_SESSION_FILES, copilotRoots, copilotSessionIdFromPath } from "./layout.js";
import {
  copilotCompactionOf,
  copilotRecordOf,
  copilotRecordTime,
  copilotSessionStartOf,
  copilotUsageOf,
  isSupportedCopilotVersion
} from "./records.js";

// Each `session.usage_record` in `events.jsonl` (and rotated `events.<n>.jsonl` segments) settles one model request;
// `session.compaction_complete` may also record the summarizer call's own usage in `compactionTokensUsed`.

function copilotUsageLines(file: UsageFile): UsageLineDecoder {
  return {
    push(record: SourcedRecord): Result<UsageRecord[], UnknownFormatGeneration> {
      const envelope = copilotRecordOf(record.value);
      if (envelope === undefined) {
        return ok([]);
      }
      if (envelope.type === "session.start") {
        const version = copilotSessionStartOf(envelope)?.version;
        if (!isSupportedCopilotVersion(version)) {
          return err({
            _tag: "UnknownFormatGeneration",
            agent: COPILOT_ID,
            file: record.file,
            line: record.line
          });
        }
        return ok([]);
      }
      if (envelope.checkpoint === true) {
        return ok([]);
      }
      const req =
        envelope.type === "session.usage_record"
          ? copilotUsageOf(envelope)
          : envelope.type === "session.compaction_complete"
            ? copilotCompactionOf(envelope)?.tokens
            : undefined;
      if (req?.usage === undefined) {
        return ok([]);
      }
      const timestamp = copilotRecordTime(envelope) ?? file.mtimeMs;
      const decoded: UsageRecord = definedFields({
        agent: COPILOT_ID,
        sessionId: file.sessionId,
        granularity: "request" as const,
        requestId: req.requestId ?? envelope.id,
        timestamp,
        model: req.model,
        provider: req.provider,
        usage: req.usage,
        modelCalls: req.modelCalls,
        source: sourceOf(record)
      });
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

const copilotUsageLayout: JsonlUsageLayout = {
  agent: COPILOT_ID,
  file: sameFile((path) => ({ sessionId: copilotSessionIdFromPath(path, true) ?? "unknown" })),
  decoder: copilotUsageLines
};

function copilotUsageKey(record: UsageRecord): string {
  return record.requestId !== undefined
    ? `${record.sessionId} req:${record.requestId}`
    : `${record.sessionId} line:${record.source.line}`;
}

export const copilotUsageDecoder: UsageDecoder = {
  specificationVersion: "usage-v1",
  agent: COPILOT_ID,
  home: COPILOT_HOME,
  usageKey: copilotUsageKey,
  sources(platform: UsagePlatform, home, options = {}) {
    return fileSources(platform, COPILOT_ID, copilotRoots(home), COPILOT_SESSION_FILES, {
      ...options,
      keep: (path) => copilotSessionIdFromPath(path, true) !== undefined,
      identify: (path) => copilotSessionIdFromPath(path, true) ?? "unknown"
    });
  },
  decode(platform, target, options) {
    return decodeJsonlUsage(platform, target, copilotUsageLayout, options);
  }
};
