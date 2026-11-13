import { err, ok, type Result } from "@rivus/agent-kit-catalog/spi";
import * as z from "zod/mini";
import {
  compactUsage,
  decodeJsonlUsage,
  fileSources,
  lenient,
  sameFile,
  sourceOf,
  type JsonlUsageLayout,
  type UsageCursor,
  type UsageDecoder,
  type UsageFile,
  type UsageLineDecoder,
  type UsagePlatform,
  type UsageRecord,
  type SourcedRecord,
  type UnknownFormatGeneration
} from "@rivus/agent-kit-sessions/spi";
import { KIMI_HOME, KIMI_ID, KIMI_SESSION_WIRE_FILE } from "./facts.js";
import { kimiRoots, KIMI_SESSION_FILES } from "./layout.js";
import { kimiUsageOfRecord, kimiUsageOf } from "./records.js";

// Every finished step of `agents/main/wire.jsonl` ends with a `step.end` loop event that carries the step's usage,
// and every turn's `turn.prompt` names the prompt id the steps belong to. One record per finished model call,
// `request` granularity, keyed by the session, the turn's prompt id and the response id. The `usage.record` lines
// only name the model; the decoder follows them for the model the next step used.

const KimiSavedState = z.looseObject({
  turnPrompts: lenient(z.record(z.string(), z.string())),
  model: lenient(z.optional(z.string()))
});

interface KimiSaved {
  turnPrompts: Record<string, string>;
  model?: string;
}

function restore(saved: unknown): KimiSaved {
  const parsed = z.safeParse(KimiSavedState, saved).data;
  return {
    turnPrompts: parsed?.turnPrompts ?? {},
    ...(parsed?.model !== undefined ? { model: parsed.model } : {})
  };
}

/** The line decoder of one wire file: a state the cursor carries, and one record per finished step. */
export function kimiUsageLines(file: UsageFile, saved?: unknown): UsageLineDecoder {
  const state = restore(saved);
  return {
    push(record: SourcedRecord): Result<UsageRecord[], UnknownFormatGeneration> {
      const value = record.value as Record<string, unknown> | undefined;
      const type = typeof value?.["type"] === "string" ? (value["type"] as string) : undefined;
      if (type === "turn.prompt") {
        const prompt = z.safeParse(
          z.looseObject({ promptId: z.string(), turnId: lenient(z.union([z.string(), z.number()])) }),
          value
        ).data;
        if (prompt === undefined) {
          return err({
            _tag: "UnknownFormatGeneration" as const,
            agent: KIMI_ID,
            file: record.file,
            line: record.line
          });
        }
        state.turnPrompts[String(prompt.turnId)] = prompt.promptId;
        return ok([]);
      }
      if (type === "usage.record") {
        const model = typeof value?.["model"] === "string" ? (value["model"] as string) : undefined;
        if (model !== undefined) {
          state.model = model;
        }
        return ok([]);
      }
      if (type !== "context.append_loop_event") {
        return ok([]);
      }
      const event = (value?.["event"] ?? {}) as Record<string, unknown>;
      if (event["type"] !== "step.end") {
        return ok([]);
      }
      const parsedUsage = kimiUsageOfRecord(event["usage"]);
      const mapped = parsedUsage === undefined ? undefined : kimiUsageOf(parsedUsage);
      const counts = mapped === undefined ? undefined : compactUsage(mapped);
      if (counts === undefined) {
        return ok([]);
      }
      const rawTurnId = event["turnId"];
      const turnId = typeof rawTurnId === "string" || typeof rawTurnId === "number" ? String(rawTurnId) : undefined;
      const promptId = turnId === undefined ? undefined : state.turnPrompts[turnId];
      const responseId = typeof event["messageId"] === "string" ? (event["messageId"] as string) : undefined;
      const time = typeof value?.["time"] === "number" ? (value["time"] as number) : file.mtimeMs;
      const decoded: UsageRecord = {
        agent: KIMI_ID,
        sessionId: file.sessionId,
        granularity: "request",
        ...(promptId !== undefined ? { requestId: promptId } : {}),
        timestamp: time,
        ...(state.model !== undefined ? { model: state.model } : {}),
        usage: counts,
        source: sourceOf(record)
      };
      if (responseId !== undefined) {
        decoded.responseId = responseId;
      }
      return ok([decoded]);
    },
    end() {
      return [];
    },
    save() {
      return structuredClone(state);
    }
  };
}

/** The layout of one wire file: the session id is the directory the wire sits two levels below. */
export const kimiUsageLayout: JsonlUsageLayout = {
  agent: KIMI_ID,
  file: sameFile((path) => {
    const parts = path.split("/").filter((part) => part !== "");
    return { sessionId: parts.at(-4) ?? "unknown" };
  }),
  decoder: kimiUsageLines
};

/** The key under which a scan counts a record once in its window: session, turn prompt and response. */
export function kimiUsageKey(record: UsageRecord): string | undefined {
  if (record.responseId !== undefined) {
    return `${record.sessionId} ${record.requestId ?? ""} ${record.responseId}`;
  }
  if (record.requestId !== undefined) {
    // A step without a response id is still one call: its line separates it from its siblings.
    return `${record.sessionId} ${record.requestId} ${record.source.line}`;
  }
  return undefined;
}

export const kimiUsageDecoder: UsageDecoder = {
  specificationVersion: "usage-v1",
  agent: KIMI_ID,
  home: KIMI_HOME,
  usageKey: kimiUsageKey,
  sources(platform: UsagePlatform, home, options = {}) {
    void options;
    return fileSources(platform, KIMI_ID, kimiRoots(home), KIMI_SESSION_FILES, {
      // The source id is the session id, which outlives moves of the working-directory buckets.
      identify: (path) =>
        path
          .split("/")
          .filter((part) => part !== "")
          .at(-4) ?? path,
      keep: (path) => path.endsWith(`/${KIMI_SESSION_WIRE_FILE}`)
    });
  },
  decode(platform, target, options) {
    return decodeJsonlUsage(platform, target, kimiUsageLayout, options);
  }
};

// A cursor's state and queue ride the decoder's save; `UsageCursor` is only re-exported for the tests' types.
export type { UsageCursor };
