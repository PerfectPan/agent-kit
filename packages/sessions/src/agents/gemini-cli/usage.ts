import { ok } from "@rivus/agent-kit-catalog";

import { type SourcePointer, sourceOf, timeOf } from "../../domain/transcript/index.js";
import { compactUsage, type Usage, type UsageRecord } from "../../domain/usage/index.js";
import { asNumber, asRecord, asString } from "../record-fields.js";
import type { UsageFile, UsageLineDecoder } from "../usage-lines.js";

const AGENT = "gemini-cli";

/**
 * The Usage of a `gemini` message's `tokens`, which copy the API's usage metadata. `input` (the prompt count) already
 * includes the cached tokens; tool-use prompt tokens (`tool`) are input billed like it, and `total` includes them, so
 * they are added to the input. `thoughts` are reasoning, billed as output and not part of `output`.
 */
export function geminiCliUsage(value: unknown): Usage | undefined {
  const tokens = asRecord(value);
  if (!tokens) {
    return undefined;
  }
  const input = asNumber(tokens.input);
  const output = asNumber(tokens.output);
  const thoughts = asNumber(tokens.thoughts);
  return compactUsage({
    inputTokens: input === undefined ? undefined : input + (asNumber(tokens.tool) ?? 0),
    outputTokens: output === undefined ? undefined : output + (thoughts ?? 0),
    totalTokens: asNumber(tokens.total),
    cacheReadTokens: asNumber(tokens.cached),
    reasoningTokens: thoughts
  });
}

interface GeminiCliUsageState {
  sessionId?: string;
  lastTime?: number;
  /** The id of the last message record, and whether its usage was reported. */
  lastId?: string;
  lastReported?: boolean;
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
      const rec = asRecord(record.value);
      if (!rec) {
        return ok([]);
      }
      const ts = timeOf(rec.timestamp) ?? state.lastTime ?? file.mtimeMs;
      state.lastTime = ts;
      if (typeof rec.projectHash === "string") {
        state.sessionId ??= asString(rec.sessionId);
      }
      const id = asString(rec.id);
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

/**
 * The usage of an older chat file, one JSON object with a `messages` array, read whole. Every record points at the
 * whole file; a message id that repeats counts once.
 */
export function geminiCliLegacyUsage(value: unknown, file: UsageFile, source: SourcePointer): UsageRecord[] {
  const chat = asRecord(value);
  const messages = Array.isArray(chat?.messages) ? chat.messages : [];
  const sessionId = asString(chat?.sessionId) ?? file.sessionId;
  const seen = new Set<string>();
  const out: UsageRecord[] = [];
  for (const item of messages) {
    const message = asRecord(item);
    const id = asString(message?.id);
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

/**
 * A `gemini` message as a record. Its `id` is the request id: the CLI keeps it when it migrates an older chat into a
 * `.jsonl` file, so a total over both files counts the message once.
 */
function messageRecord(
  message: Record<string, unknown>,
  usage: Usage,
  timestamp: number,
  sessionId: string,
  source: SourcePointer
): UsageRecord {
  const id = asString(message.id);
  const model = asString(message.model);
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

/** A saved state is the decoder's own output, passed back through a cursor; a missing field starts empty. */
function restore(saved: unknown): GeminiCliUsageState {
  const state = asRecord(saved);
  const sessionId = asString(state?.sessionId);
  const lastTime = asNumber(state?.lastTime);
  const lastId = asString(state?.lastId);
  return {
    ...(sessionId === undefined ? {} : { sessionId }),
    ...(lastTime === undefined ? {} : { lastTime }),
    ...(lastId === undefined ? {} : { lastId, lastReported: state?.lastReported === true })
  };
}

/** The key under which a scan counts a record once in its window: the session and the message id, which a migrated chat keeps. */
export function geminiCliUsageKey(record: UsageRecord): string | undefined {
  return record.requestId === undefined ? undefined : `${record.sessionId} ${record.requestId}`;
}
