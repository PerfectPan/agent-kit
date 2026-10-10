import { ok } from "@rivus/agent-kit-catalog";
import * as z from "zod/mini";

import { type SourcePointer, sourceOf, timeOf } from "../../transcript/index.js";
import { compactUsage, type Usage, type UsageRecord } from "../index.js";
import { lenient } from "../../transcript/adapters/lenient.js";
import { logTimestamp } from "../../transcript/adapters/timestamp.js";
import type { UsageFile, UsageLineDecoder } from "./usage-lines.js";

const AGENT = "gemini-cli";

/** The `tokens` of a `gemini` message, which copy the API's usage metadata. */
const GeminiCliTokens = z.looseObject({
  input: lenient(z.number()),
  output: lenient(z.number()),
  thoughts: lenient(z.number()),
  tool: lenient(z.number()),
  total: lenient(z.number()),
  cached: lenient(z.number())
});

/** A chat record. Fields this reader does not name stay in the record, so a `$patch` marker is still visible. */
const GeminiCliRecord = z.looseObject({
  id: lenient(z.string()),
  type: lenient(z.string()),
  model: lenient(z.string()),
  projectHash: lenient(z.string()),
  sessionId: lenient(z.string()),
  timestamp: logTimestamp
});

type GeminiCliRecordValue = z.output<typeof GeminiCliRecord>;

/**
 * The Usage of a `gemini` message's `tokens`, which copy the API's usage metadata. `input` (the prompt count) already
 * includes the cached tokens; tool-use prompt tokens (`tool`) are input billed like it, and `total` includes them, so
 * they are added to the input. `thoughts` are reasoning, billed as output and not part of `output`.
 */
export function geminiCliUsage(value: unknown): Usage | undefined {
  const tokens = z.safeParse(GeminiCliTokens, value).data;
  return compactUsage({
    inputTokens: tokens?.input === undefined ? undefined : tokens.input + (tokens.tool ?? 0),
    outputTokens: tokens?.output === undefined ? undefined : tokens.output + (tokens.thoughts ?? 0),
    totalTokens: tokens?.total,
    cacheReadTokens: tokens?.cached,
    reasoningTokens: tokens?.thoughts
  });
}

interface GeminiCliUsageState {
  sessionId?: string;
  lastTime?: number;
  /** The id of the last message record, and whether its usage was reported. */
  lastId?: string;
  lastReported?: boolean;
}

/** The state a cursor carries back, reading only the fields it understands. */
const GeminiCliSavedState = z.looseObject({
  sessionId: lenient(z.string()),
  lastTime: lenient(z.number()),
  lastId: lenient(z.string()),
  lastReported: lenient(z.boolean())
});

/** A saved state is the decoder's own output, passed back through a cursor; a missing field starts empty. */
function restore(saved: unknown): GeminiCliUsageState {
  const state = z.safeParse(GeminiCliSavedState, saved).data;
  return {
    ...(state?.sessionId === undefined ? {} : { sessionId: state.sessionId }),
    ...(state?.lastTime === undefined ? {} : { lastTime: state.lastTime }),
    ...(state?.lastId === undefined ? {} : { lastId: state.lastId, lastReported: state.lastReported === true })
  };
}

/**
 * A `gemini` message as a record. Its `id` is the request id: the CLI keeps it when it migrates an older chat into a
 * `.jsonl` file, so a total over both files counts the message once.
 */
function messageRecord(
  message: GeminiCliRecordValue,
  usage: Usage,
  timestamp: number,
  sessionId: string,
  source: SourcePointer
): UsageRecord {
  const { id, model } = message;
  return {
    agent: AGENT,
    sessionId,
    granularity: "request",
    ...(id ? { requestId: id } : {}),
    timestamp,
    ...(model ? { model } : {}),
    usage,
    source
  };
}

/**
 * Gemini CLI's usage over one `.jsonl` chat: one record per `gemini` message that has `tokens`. The CLI appends a
 * message again each time it changes (tokens attached, tool calls added), only while it is the chat's last message,
 * and attaches tokens once; so a message counts at its first record with tokens, and its later copies are skipped.
 */
export function geminiCliUsageLines(file: UsageFile, saved?: unknown): UsageLineDecoder {
  const state = restore(saved);
  return {
    push(record) {
      const rec = z.safeParse(GeminiCliRecord, record.value).data;
      if (!rec) {
        return ok([]);
      }
      const ts = timeOf(rec.timestamp) ?? state.lastTime ?? file.mtimeMs;
      state.lastTime = ts;
      if (rec.projectHash !== undefined) {
        state.sessionId ??= rec.sessionId;
      }
      const id = rec.id;
      if (!id || "$patch" in rec) {
        return ok([]);
      }
      const again = id === state.lastId;
      state.lastId = id;
      state.lastReported = again && state.lastReported === true;
      if (state.lastReported || rec.type !== "gemini") {
        return ok([]);
      }
      const usage = geminiCliUsage(rec.tokens);
      if (!usage) {
        return ok([]);
      }
      state.lastReported = true;
      return ok([messageRecord(rec, usage, ts, state.sessionId ?? file.sessionId, sourceOf(record))]);
    },
    end() {
      return [];
    },
    save() {
      return structuredClone(state);
    }
  };
}

/** An older chat: one JSON object, with the session id and the `messages` array. */
const GeminiCliLegacyChat = z.looseObject({
  sessionId: lenient(z.string()),
  messages: lenient(z.array(z.unknown()))
});

/**
 * The usage of an older chat file, one JSON object with a `messages` array, read whole. Every record points at the
 * whole file; a message id that repeats counts once.
 */
export function geminiCliLegacyUsage(value: unknown, file: UsageFile, source: SourcePointer): UsageRecord[] {
  const chat = z.safeParse(GeminiCliLegacyChat, value).data;
  const messages = chat?.messages ?? [];
  const sessionId = chat?.sessionId ?? file.sessionId;
  const seen = new Set<string>();
  const out: UsageRecord[] = [];
  for (const item of messages) {
    const message = z.safeParse(GeminiCliRecord, item).data;
    const id = message?.id;
    const usage = message?.type === "gemini" ? geminiCliUsage(message.tokens) : undefined;
    if (!message || !usage || (id !== undefined && seen.has(id))) {
      continue;
    }
    if (id !== undefined) {
      seen.add(id);
    }
    out.push(messageRecord(message, usage, timeOf(message.timestamp) ?? file.mtimeMs, sessionId, source));
  }
  return out;
}

/** The key under which a scan counts a record once in its window: the session and the message id, which a migrated chat keeps. */
export function geminiCliUsageKey(record: UsageRecord): string | undefined {
  return record.requestId === undefined ? undefined : `${record.sessionId} ${record.requestId}`;
}
