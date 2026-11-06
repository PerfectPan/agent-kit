import { ok, type Result } from "@rivus/agent-kit-catalog/spi";

import {
  assignSeq,
  baseEvent,
  type Capability,
  inheritTimes,
  lineId,
  type ParsedTranscript,
  MAIN_LANE_ID,
  markOrphanToolResults,
  shadowBefore,
  recordTime,
  type SkippedRecord,
  sourceOf,
  type SourcedRecord,
  type TranscriptEvent,
  type TranscriptEventBody,
  type TranscriptEventOf,
  type TranscriptEventKind,
  type TranscriptSession,
  type UnknownFormatGeneration,
  type Usage
} from "@rivus/agent-kit-sessions/spi";
import { geminiCliChatItem, type GeminiCliToolCall } from "./records.js";

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
  /** Wins over the session id the chat's records carry. */
  sessionId?: string | undefined;
}

/** One tool call's events, for the rewrites later rows apply to them. */
interface ToolEvents {
  call?: TranscriptEventOf<"tool_call">;
  result?: TranscriptEventOf<"tool_result">;
}

/** One tool call's payload, as the call's last record shows it. */
function toolCallPayload(call: GeminiCliToolCall): TranscriptEventOf<"tool_call">["payload"] {
  return {
    callId: call.id,
    name: call.name,
    ...(call.args === undefined ? {} : { args: call.args })
  };
}

/** One tool call's result payload, from its last ended record; the output is the text the user saw. */
function toolResultPayload(
  callId: string,
  result: NonNullable<GeminiCliToolCall["result"]>
): TranscriptEventOf<"tool_result">["payload"] {
  return {
    callId,
    isError: result.isError,
    ...(result.output === undefined ? {} : { output: result.output })
  };
}

function nextFreeOf(events: readonly TranscriptEvent[], usedIds: Set<string>, base: string): string {
  let candidate = base;
  for (let serial = 1; usedIds.has(candidate) || events.some((event) => event.id === candidate); serial += 1) {
    candidate = `${base}:${serial}`;
  }
  return candidate;
}

/**
 * Places one message's request immediately before its assistant event: the request precedes the output it priced.
 * A message's usage rides its first tokens-bearing record, so the placement runs once per message id.
 */
function placeMessageRequest(
  events: TranscriptEvent[],
  assistant: TranscriptEventOf<"assistant">,
  record: SourcedRecord,
  id: string,
  usage: Usage,
  model: string | undefined,
  usedIds: Set<string>,
  placed: Set<string>
): void {
  if (placed.has(id)) {
    return;
  }
  placed.add(id);
  const payload = {
    granularity: "request" as const,
    ...(model === undefined ? {} : { model }),
    usage
  };
  const requestId = `request:${id}`;
  const reqId = usedIds.has(requestId) ? nextFreeOf(events, usedIds, `request:${lineId(record)}`) : requestId;
  usedIds.add(reqId);
  events.splice(
    events.indexOf(assistant),
    0,
    baseEvent(record, "request", payload, { id: reqId, ts: assistant.ts, requestId: id })
  );
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
  const skipped: SkippedRecord[] = [];
  const items = records.map((record) => geminiCliChatItem(record.value));
  const times = inheritTimes(records.map(recordTime));
  const chats = new Map<string, TranscriptEventOf<"assistant">>();
  /** The message ids whose request has been placed; the usage rides the message's first tokens-bearing record. */
  const requestPlaced = new Set<string>();
  const tools = new Map<string, ToolEvents>();
  const usedIds = new Set<string>();
  let sessionId = options.sessionId;
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
    const item = items[index]!;
    const ts = times[index]!;
    const skip = (reason: string): void => {
      skipped.push({ reason, source: sourceOf(record) });
    };
    if (item.kind === "invalid") {
      skip("invalid-record");
      continue;
    }
    if (item.kind === "patch") {
      // The marker edits one earlier message's content in place; the patch itself becomes a skipped record.
      const message = chats.get(item.messageId);
      if (message !== undefined && item.content !== undefined) {
        message.payload.text = item.content;
      }
      skip("message-patch");
      continue;
    }
    if (item.kind === "set") {
      skip("chat-set");
      continue;
    }
    startedAt = Math.min(startedAt ?? ts, ts);
    endedAt = Math.max(endedAt ?? ts, ts);
    sessionId ??= item.sessionId;
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

    switch (item.kind) {
      case "header":
        // The chat's header line names the session id (already taken) and no item.
        skip("chat-header");
        break;
      case "user":
        emit("user", item.text === undefined ? {} : { text: item.text });
        break;
      case "thinking":
        emit("reasoning", item.text === undefined ? {} : { text: item.text });
        break;
      case "compression":
        emit("compaction", {
          trigger: "auto",
          ...(item.preTokens === undefined ? {} : { preTokens: item.preTokens }),
          ...(item.postTokens === undefined ? {} : { postTokens: item.postTokens })
        });
        break;
      case "compression-pending":
        skip("compact-pending");
        break;
      case "notice":
        emit("system", { type: item.type, ...(item.text === undefined ? {} : { text: item.text }) });
        break;
      case "unknown":
        emit("unknown", { type: item.type });
        break;
      case "gemini": {
        let assistant = chats.get(item.id);
        if (assistant === undefined) {
          assistant = baseEvent(record, "assistant", item.text === undefined ? {} : { text: item.text }, {
            id: nextFree(`${lineId(record)}:${events.length + 1}`),
            ts
          });
          events.push(assistant);
          usedIds.add(assistant.id);
          chats.set(item.id, assistant);
        } else {
          // The CLI appends the message again when it changes; the last record is its final text.
          if (item.text !== undefined) {
            assistant.payload.text = item.text;
          }
          skip("message-update");
        }
        if (item.usage !== undefined) {
          placeMessageRequest(events, assistant, record, item.id, item.usage, item.model, usedIds, requestPlaced);
        }
        for (let invalid = 0; invalid < item.invalidToolCalls; invalid++) {
          skip("invalid-tool-call");
        }
        for (const call of item.toolCalls) {
          const seen = tools.get(call.id) ?? {};
          tools.set(call.id, seen);
          // The payload is replaced whole, not merged field by field: a later record can take `args` away again.
          if (!seen.call) {
            const event = baseEvent(record, "tool_call", toolCallPayload(call), {
              id: nextFree(`${lineId(record)}:${call.id}:${events.length + 1}`),
              ts
            });
            events.push(event);
            usedIds.add(event.id);
            seen.call = event;
          } else {
            seen.call.payload = toolCallPayload(call);
          }
          if (call.result === undefined) {
            skip("tool-progress");
            continue;
          }
          const result = toolResultPayload(call.id, call.result);
          if (seen.result) {
            Object.assign(seen.result.payload, result);
            skip("tool-progress");
            continue;
          }
          const event = baseEvent(record, "tool_result", result, {
            id: nextFree(`${lineId(record)}:${call.id}:result:${events.length + 1}`),
            ts
          });
          events.push(event);
          usedIds.add(event.id);
          seen.result = event;
        }
        break;
      }
    }
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
