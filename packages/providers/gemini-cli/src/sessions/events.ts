import { ok, type Result } from "@rivus/agent-kit-catalog/spi";
import { geminiCliUsage } from "../usage.js";

import {
  assignSeq,
  baseEvent,
  type Capability,
  inheritTimes,
  lineId,
  type ParsedTranscript,
  MAIN_LANE_ID,
  markOrphanToolResults,
  placeRequest,
  shadowBefore,
  recordTime,
  sourceOf,
  type SourcedRecord,
  type TranscriptEvent,
  type TranscriptEventBody,
  type TranscriptEventOf,
  type TranscriptEventKind,
  type TranscriptSession,
  type UnknownFormatGeneration
} from "@rivus/agent-kit-sessions/spi";
import {
  geminiCliChatRecords,
  geminiCliToolCallOf,
  type GeminiCliToolCallValue,
  isGeminiCliToolDone,
  isGeminiCliToolError
} from "./records.js";

/**
 * Recorded by every Gemini CLI chat. Usage travels on `gemini` records' `tokens`, compaction on `compression`
 * items, and reasoning on `thinking` items; there are no subagent, hook or system-prompt records. A `$patch` marker
 * amends an earlier message's content in place.
 */
export const GEMINI_CLI_CAPABILITIES: readonly Capability[] = [
  "requests",
  "usage",
  "reasoning",
  "compaction",
  "compactionTokens"
];

/** The capabilities one translated transcript shows, as its events demonstrate them. */
export function geminiCapabilities(events: readonly TranscriptEvent[]): Capability[] {
  const caps: Capability[] = [];
  if (events.some((event) => event.kind === "request")) {
    caps.push("requests");
  }
  if (events.some((event) => event.kind === "request" && event.payload.usage !== undefined)) {
    caps.push("usage");
  }
  if (events.some((event) => event.kind === "reasoning")) {
    caps.push("reasoning");
  }
  if (events.some((event) => event.kind === "compaction")) {
    caps.push("compaction");
  }
  if (
    events.some(
      (event) =>
        event.kind === "compaction" &&
        (Number.isFinite(event.payload.preTokens) || Number.isFinite(event.payload.postTokens))
    )
  ) {
    caps.push("compactionTokens");
  }
  return caps;
}

export interface GeminiCliTranslateOptions {
  /** The fallback session id when the chat's header names none. */
  sessionId?: string;
  /** The session id a legacy `.json` chat carries in its object, over `sessionId`. */
  legacySessionId?: string;
}

/** One tool call's events, for the rewrites later rows apply to them. */
interface ToolEvents {
  call?: TranscriptEventOf<"tool_call">;
  result?: TranscriptEventOf<"tool_result">;
}

/** One tool call's payload, as the call's last record shows it. */
function toolCallPayload(call: GeminiCliToolCallValue): TranscriptEventOf<"tool_call">["payload"] {
  const args = call.args;
  return {
    callId: String(call.id ?? ""),
    name: String(call.name ?? ""),
    ...(args !== undefined ? { args } : {})
  };
}

/** One tool call's result payload, from its last done record; `resultDisplay` is the output the user saw. */
function toolResultPayload(
  call: GeminiCliToolCallValue,
  isError: boolean
): TranscriptEventOf<"tool_result">["payload"] {
  const output = call.resultDisplay;
  return {
    callId: String(call.id ?? ""),
    isError,
    ...(typeof output === "string" ? { output } : {})
  };
}

/** The id a `$patch` marker names, or `undefined` when the marker is not a patch of one message. */
function valueOfMarkerId(marker: unknown): string | undefined {
  if (typeof marker !== "object" || marker === null) {
    return undefined;
  }
  const id = (marker as { id?: string | number }).id;
  return id === undefined ? undefined : String(id);
}

/** The content a `$patch` marker writes into the message, or `undefined` when it writes none. */
function valueOfMarkerContent(marker: unknown): string | undefined {
  if (typeof marker !== "object" || marker === null) {
    return undefined;
  }
  const content = (marker as Record<string, unknown>).content;
  return typeof content === "string" ? content : undefined;
}

/** The session id a chat header line carries, or `undefined` when the line names none. */
function valueOfMarkerSessionId(value: Record<string, unknown>): string | undefined {
  return typeof value.sessionId === "string" ? value.sessionId : undefined;
}

/**
 * Translates one chat's records into transcript events. The CLI appends a message again whenever it changes (tokens
 * attached, tool calls added, content edited), always while it is the chat's last message: a later record whose id
 * an earlier one holds updates that event's payload in place, and the earlier copies are reported as skipped
 * `message-update`; a `$patch` marker edits the message's content the same way. Every `gemini` message that carries
 * `tokens` is one request (`granularity` is `request`, the per-call usage), placed before the message's output.
 */
export function translateGeminiCliRecords(
  records: readonly SourcedRecord[],
  options: GeminiCliTranslateOptions = {}
): Result<ParsedTranscript, UnknownFormatGeneration> {
  const events: TranscriptEvent[] = [];
  const skipped: { reason: string; source: ReturnType<typeof sourceOf> }[] = [];
  const parsed = geminiCliChatRecords(records);
  const times = inheritTimes(records.map(recordTime));
  const chats = new Map<string, TranscriptEventOf<"assistant">>();
  const tools = new Map<string, ToolEvents>();
  const usedIds = new Set<string>();
  let segment = 0;
  let sessionId: string | undefined = options.legacySessionId ?? options.sessionId;
  let startedAt: number | undefined;
  let endedAt: number | undefined;

  /** The first id of `base`'s shape no event holds: `base` itself, then `base:1`, `base:2`, …. */
  const nextFree = (base: string): string => {
    let candidate = base;
    for (let serial = 1; usedIds.has(candidate); serial += 1) {
      candidate = `${base}:${serial}`;
    }
    return candidate;
  };

  for (let index = 0; index < records.length; index++) {
    const record = records[index]!;
    const value = parsed[index];
    const ts = times[index]!;
    const raw = record.value as Record<string, unknown>;
    if ("$patch" in raw) {
      // The marker edits one earlier message's content in place; the patch itself becomes a skipped record.
      const patchId = valueOfMarkerId(raw.$patch);
      const patchContent = valueOfMarkerContent(raw.$patch);
      if (patchId !== undefined) {
        const message = chats.get(patchId);
        if (message !== undefined && patchContent !== undefined) {
          message.payload.text = patchContent;
        }
        skipped.push({ reason: "message-patch", source: sourceOf(record) });
        continue;
      }
      skipped.push({ reason: "invalid-record", source: sourceOf(record) });
      continue;
    }
    if ("$set" in raw) {
      skipped.push({ reason: "chat-set", source: sourceOf(record) });
      continue;
    }
    if (value === undefined) {
      // A chat header line names the session id and carries no item; a line this reader cannot shape at all is
      // recorded as invalid.
      const headerSessionId = valueOfMarkerSessionId(raw);
      if (headerSessionId !== undefined) {
        sessionId ??= headerSessionId;
        skipped.push({ reason: "chat-header", source: sourceOf(record) });
        continue;
      }
      skipped.push({ reason: "invalid-record", source: sourceOf(record) });
      continue;
    }
    startedAt = Math.min(startedAt ?? ts, ts);
    endedAt = Math.max(endedAt ?? ts, ts);
    sessionId ??= value.sessionId;
    const id = value.id;
    const kind = value.type;
    const content = value.content;
    if (id === undefined && kind === undefined) {
      // The chat's header line: it names the session id (already taken) and no item.
      skipped.push({ reason: "chat-header", source: sourceOf(record) });
      continue;
    }
    /** Emits one event with a fresh serial of `lineId`, stamped with the record's inherited time. */
    const emit = (eventKind: TranscriptEventKind, payload: TranscriptEventBody["payload"]): TranscriptEvent => {
      const event = baseEvent(record, eventKind, payload, {
        id: nextFree(`${lineId(record)}:${events.length + 1}`),
        ts
      });
      events.push(event);
      usedIds.add(event.id);
      return event;
    };

    if (id === undefined) {
      // The chat's header line names the session id and nothing else; a typed record without an id is a notice the
      // CLI shows in place, kept as a system event.
      if (kind === undefined && value.sessionId !== undefined) {
        skipped.push({ reason: "chat-header", source: sourceOf(record) });
        continue;
      }
      if ("$set" in raw) {
        skipped.push({ reason: "chat-set", source: sourceOf(record) });
        continue;
      }
      emit("system", { type: kind ?? "unknown", ...(content === undefined ? {} : { text: content }) });
      continue;
    }

    if (kind === "user") {
      emit("user", content === undefined ? {} : { text: content });
      continue;
    }

    if (kind === "gemini") {
      const seen = chats.get(id);
      if (seen) {
        // The CLI appends the message again when it changes; the last record is its final text.
        if (content !== undefined) {
          seen.payload.text = content;
        }
        skipped.push({ reason: "message-update", source: sourceOf(record) });
      } else {
        const assistant = baseEvent(record, "assistant", content === undefined ? {} : { text: content }, {
          id: nextFree(`${lineId(record)}:${events.length + 1}`),
          ts
        });
        events.push(assistant);
        usedIds.add(assistant.id);
        chats.set(id, assistant);
        const usage = geminiCliUsage(raw.tokens);
        if (usage) {
          const payload = {
            granularity: "request" as const,
            ...(value.model === undefined ? {} : { model: value.model }),
            usage
          };
          const requestId = `request:${id}`;
          const reqId = usedIds.has(requestId) ? nextFree(`request:${lineId(record)}`) : requestId;
          usedIds.add(reqId);
          segment = placeRequest(
            events,
            segment,
            baseEvent(record, "request", payload, { id: reqId, ts, requestId: id })
          );
          segment = events.length;
        }
      }
      const toolCalls = raw.toolCalls;
      if (Array.isArray(toolCalls)) {
        for (const rawCall of toolCalls) {
          const call = geminiCliToolCallOf(rawCall);
          if (call === undefined) {
            continue;
          }
          const callId = String(call.id ?? "");
          const done = isGeminiCliToolDone(call.status);
          const seen = tools.get(callId) ?? {};
          tools.set(callId, seen);
          // The payload is replaced whole, not merged field by field: a later record can take `args` away again.
          if (!seen.call) {
            const event = baseEvent(record, "tool_call", toolCallPayload(call), {
              id: nextFree(`${lineId(record)}:${callId}:${events.length + 1}`),
              ts
            });
            events.push(event);
            usedIds.add(event.id);
            seen.call = event;
          } else {
            seen.call.payload = toolCallPayload(call);
          }
          if (!done) {
            skipped.push({ reason: "tool-progress", source: sourceOf(record) });
            continue;
          }
          const result = toolResultPayload(call, isGeminiCliToolError(call.status));
          if (seen.result) {
            Object.assign(seen.result.payload, result);
            skipped.push({ reason: "tool-progress", source: sourceOf(record) });
            continue;
          }
          const event = baseEvent(record, "tool_result", result, {
            id: nextFree(`${lineId(record)}:${callId}:result:${events.length + 1}`),
            ts
          });
          events.push(event);
          usedIds.add(event.id);
          seen.result = event;
        }
      }
      continue;
    }

    if (kind === "thinking") {
      const thought = raw.thought as { subject?: unknown; description?: unknown } | undefined;
      const description = typeof thought?.description === "string" ? thought.description : undefined;
      const subject = typeof thought?.subject === "string" ? thought.subject : undefined;
      const body = description ?? subject;
      emit("reasoning", body === undefined ? {} : { text: body });
      continue;
    }

    if (kind === "compression") {
      const compression = raw.compression as
        | { isPending?: unknown; originalTokenCount?: unknown; newTokenCount?: unknown }
        | undefined;
      if (compression?.isPending === true) {
        skipped.push({ reason: "compact-pending", source: sourceOf(record) });
        continue;
      }
      const pre = typeof compression?.originalTokenCount === "number" ? compression.originalTokenCount : undefined;
      const post = typeof compression?.newTokenCount === "number" ? compression.newTokenCount : undefined;
      emit("compaction", {
        trigger: "auto",
        ...(pre === undefined ? {} : { preTokens: pre }),
        ...(post === undefined ? {} : { postTokens: post })
      });
      continue;
    }

    if (kind === "info" || kind === "warning" || kind === "error") {
      emit("system", { type: kind, ...(content === undefined ? {} : { text: content }) });
      continue;
    }

    emit("unknown", { type: kind ?? "unknown" });
  }

  for (const compaction of events) {
    if (compaction.kind === "compaction") {
      shadowBefore(events, compaction);
    }
  }
  markOrphanToolResults(events);
  assignSeq(events);
  const session: TranscriptSession = {
    id: sessionId ?? "unknown",
    ...(startedAt === undefined ? {} : { startedAt }),
    ...(endedAt === undefined ? {} : { endedAt })
  };
  return ok({
    events,
    skipped,
    session,
    agents: [{ id: MAIN_LANE_ID }]
  });
}
