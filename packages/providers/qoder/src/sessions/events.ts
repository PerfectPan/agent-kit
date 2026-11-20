import { definedFields } from "@rivus/agent-kit-catalog/spi";
import {
  assignSeq,
  baseEvent,
  inheritTimes,
  lineId,
  markOrphanToolResults,
  shadowBefore,
  skipRecord,
  type ParsedTranscript,
  type RequestPayload,
  type SourcedRecord,
  type TranscriptEvent,
  type TranscriptEventBody,
  type TranscriptEventOf,
  type TranscriptSession
} from "@rivus/agent-kit-sessions/spi";
import { QODER_ID } from "../facts.js";
import { qoderRecordOf, qoderRecordTime, qoderUsageOf, qoderUsageSize } from "../records.js";
import { QODER_CAPABILITIES } from "./capabilities.js";

interface QoderStep {
  readonly ok: true;
  readonly isMainLane: boolean;
  readonly parts: readonly TranscriptEventBody[];
}

interface QoderTranslation {
  step(record: SourcedRecord, agentId?: string): QoderStep;
  requests(): readonly RequestPayload[];
  subagentCount(): number;
  finish(session: TranscriptSession): ParsedTranscript;
}

function mergeRequestPayload(existing: RequestPayload, incoming: RequestPayload): RequestPayload {
  const usage =
    qoderUsageSize(incoming.usage) >= qoderUsageSize(existing.usage)
      ? (incoming.usage ?? existing.usage)
      : existing.usage;
  return definedFields({
    granularity: "request" as const,
    model: incoming.model ?? existing.model,
    responseId: incoming.responseId ?? existing.responseId,
    finishReason: incoming.finishReason ?? existing.finishReason,
    usage
  });
}

export function createQoderTranslation({ retain }: { readonly retain: boolean }): QoderTranslation {
  const events: TranscriptEvent[] = [];
  const skipped: ParsedTranscript["skipped"] = [];
  const subagents = new Set<string>();
  // Tracks the request event (in retain mode) or payload (in summarize mode) per assistant request key so streaming
  // fragments merge into one request keeping the largest usage and latest metadata.
  const requestEvents = new Map<string, TranscriptEventOf<"request">>();
  const requestPayloads = new Map<string, RequestPayload>();
  let anonymousIndex = 0;
  let sessionCwd: string | undefined;
  let agentVersion: string | undefined;

  const push = (
    record: SourcedRecord,
    partIndex: number,
    body: TranscriptEventBody,
    ts: number,
    extra: { readonly requestId?: string; readonly agentId?: string }
  ): TranscriptEvent | undefined => {
    if (!retain) {
      return undefined;
    }
    const id = lineId(record, partIndex);
    const event = baseEvent(
      record,
      body.kind,
      body.payload,
      definedFields({ id, ts, requestId: extra.requestId, agentId: extra.agentId })
    );
    events.push(event);
    return event;
  };

  return {
    step(record: SourcedRecord, laneAgentId?: string): QoderStep {
      const parsed = qoderRecordOf(record.value);
      if (parsed === undefined) {
        if (retain) {
          skipRecord(skipped, record, "invalid-shape");
        }
        return { ok: true, isMainLane: laneAgentId === undefined, parts: [] };
      }
      if (sessionCwd === undefined && parsed.cwd !== undefined) {
        sessionCwd = parsed.cwd;
      }
      if (agentVersion === undefined && parsed.version !== undefined) {
        agentVersion = parsed.version;
      }

      const ts = qoderRecordTime(parsed) ?? 0;
      const rawAgentId = laneAgentId ?? (parsed.isSidechain ? parsed.agentId : undefined);
      const agentId = rawAgentId === QODER_ID ? undefined : rawAgentId;
      if (agentId !== undefined) {
        subagents.add(agentId);
      }
      const isMainLane = agentId === undefined;
      const parts: TranscriptEventBody[] = [];
      let partIndex = 0;
      const emit = (body: TranscriptEventBody, requestId?: string): TranscriptEvent | undefined => {
        parts.push(body);
        return push(record, partIndex++, body, ts, { requestId, agentId });
      };

      switch (parsed.type) {
        case "user": {
          const content = parsed.message?.content;
          if (typeof content === "string") {
            if (content !== "") {
              emit({
                kind: "user",
                payload: definedFields({
                  text: content,
                  ...(parsed.isMeta ? { meta: true } : {}),
                  ...(parsed.isCompactSummary ? { compactSummary: true } : {})
                })
              });
            }
          } else if (Array.isArray(content)) {
            for (const block of content) {
              if (block.type === "text" && block.text !== "") {
                emit({
                  kind: "user",
                  payload: definedFields({
                    text: block.text,
                    ...(parsed.isMeta ? { meta: true } : {}),
                    ...(parsed.isCompactSummary ? { compactSummary: true } : {})
                  })
                });
              } else if (block.type === "tool_result") {
                emit({
                  kind: "tool_result",
                  payload: {
                    callId: block.tool_use_id,
                    ...definedFields({
                      output: block.content,
                      ...(block.is_error === true ? { isError: true } : {})
                    })
                  }
                });
              }
            }
          }
          break;
        }
        case "assistant": {
          const msg = parsed.message;
          const usage = qoderUsageOf(msg?.usage);
          const stableKey = parsed.requestId ?? msg?.id;
          const mapKey = stableKey === undefined ? undefined : `${agentId ?? ""}\0${stableKey}`;
          let requestId: string | undefined;

          if (usage !== undefined || msg?.model !== undefined || msg?.id !== undefined) {
            const incoming: RequestPayload = definedFields({
              granularity: "request" as const,
              model: msg?.model,
              responseId: msg?.id,
              finishReason: msg?.stop_reason ?? undefined,
              usage
            });
            if (mapKey !== undefined) {
              requestId = stableKey;
              const existingPayload = requestPayloads.get(mapKey);
              if (existingPayload !== undefined) {
                const merged = mergeRequestPayload(existingPayload, incoming);
                requestPayloads.set(mapKey, merged);
                const existingEvent = requestEvents.get(mapKey);
                if (existingEvent !== undefined) {
                  existingEvent.payload = merged;
                }
              } else {
                requestPayloads.set(mapKey, incoming);
                const event = emit({ kind: "request", payload: incoming }, requestId);
                if (event !== undefined && event.kind === "request") {
                  requestEvents.set(mapKey, event);
                }
              }
            } else {
              requestId = lineId(record, 0);
              requestPayloads.set(`\0anon\0${anonymousIndex++}`, incoming);
              emit({ kind: "request", payload: incoming }, requestId);
            }
          } else if (mapKey !== undefined && requestPayloads.has(mapKey)) {
            requestId = stableKey;
          }

          const content = msg?.content;
          if (typeof content === "string") {
            if (content !== "") {
              emit({ kind: "assistant", payload: { text: content } }, requestId);
            }
          } else if (Array.isArray(content)) {
            for (const block of content) {
              if (block.type === "text" && block.text !== "") {
                emit({ kind: "assistant", payload: { text: block.text } }, requestId);
              } else if (block.type === "thinking" && block.thinking !== "") {
                emit({ kind: "reasoning", payload: { text: block.thinking } }, requestId);
              } else if (block.type === "redacted_thinking") {
                emit({ kind: "reasoning", payload: { redacted: true } }, requestId);
              } else if (block.type === "tool_use") {
                emit(
                  {
                    kind: "tool_call",
                    payload: { callId: block.id, name: block.name, ...definedFields({ args: block.input }) }
                  },
                  requestId
                );
              }
            }
          }
          break;
        }
        case "system": {
          if (parsed.subtype === "compact_boundary") {
            const compaction = emit({
              kind: "compaction",
              payload: { trigger: "auto" }
            });
            if (compaction !== undefined) {
              shadowBefore(events, compaction);
            }
          } else if (parsed.content !== undefined && parsed.content !== "") {
            emit({ kind: "system", payload: { type: parsed.subtype ?? "system", text: parsed.content } });
          }
          break;
        }
        default: {
          if (retain) {
            skipRecord(skipped, record, `unhandled-type:${parsed.type}`);
          }
          break;
        }
      }

      if (retain && parts.length === 0 && skipped.at(-1)?.source.line !== record.line) {
        skipRecord(skipped, record, "bookkeeping");
      }

      return { ok: true, isMainLane, parts };
    },

    requests(): readonly RequestPayload[] {
      return [...requestPayloads.values()];
    },

    subagentCount(): number {
      return subagents.size;
    },

    finish(session): ParsedTranscript {
      const times = inheritTimes(events.map((event) => (event.ts > 0 ? event.ts : undefined)));
      for (const [index, event] of events.entries()) {
        event.ts = times[index]!;
      }
      markOrphanToolResults(events);
      assignSeq(events);
      const agents: ParsedTranscript["agents"] = [
        { id: QODER_ID },
        ...[...subagents].map((id) => ({ id, parentId: QODER_ID }))
      ];
      return definedFields({
        session: definedFields({
          ...session,
          ...(sessionCwd !== undefined && session.cwd === undefined ? { cwd: sessionCwd } : {})
        }),
        agentVersion,
        agents,
        events,
        skipped
      });
    }
  };
}

export { QODER_CAPABILITIES };
