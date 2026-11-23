import { definedFields } from "@rivus/agent-kit-catalog/spi";
import {
  type CompactionPayload,
  finalizeTranscriptEvents,
  type HookPayload,
  lineId,
  pushRetainedEvent,
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
import {
  type QoderAttachment,
  type QoderRecord,
  qoderRecordOf,
  qoderRecordTime,
  qoderUsageOf,
  qoderUsageSize
} from "../records.js";
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

/** A `compact_boundary`'s trigger and token counts, as its `compactMetadata` records them. */
function compactionPayload(metadata: QoderRecord["compactMetadata"]): CompactionPayload {
  const trigger = metadata?.trigger;
  const preTokens = metadata?.preTokens;
  const postTokens = metadata?.postTokens;
  return {
    ...(trigger === "auto" || trigger === "manual" ? { trigger } : {}),
    ...(preTokens === undefined ? {} : { preTokens }),
    ...(postTokens === undefined ? {} : { postTokens })
  };
}

/** A `hook_*` attachment: the hook's name, the event it ran for, and its exit code and duration when it has them. */
function hookPayload(type: string, attachment: QoderAttachment): HookPayload {
  return {
    type,
    ...definedFields({
      // SessionStart hooks record an empty name, which is no name.
      name: attachment.hookName === "" ? undefined : attachment.hookName,
      event: attachment.hookEvent ?? attachment.hookEventName,
      exitCode: attachment.exitCode,
      durationMs: attachment.durationMs
    })
  };
}

/**
 * The record uuids from a compaction's `compactMetadata.preservedSegment.headUuid` through its `tailUuid`: the
 * messages the compaction kept in the context, which it does not shadow. `undefined` when it kept none.
 */
function preservedUuids(
  recordUuids: readonly string[],
  metadata: QoderRecord["compactMetadata"]
): Set<string> | undefined {
  const head = metadata?.preservedSegment?.headUuid;
  const tail = metadata?.preservedSegment?.tailUuid;
  if (head === undefined || tail === undefined) {
    return undefined;
  }
  const start = recordUuids.indexOf(head);
  const end = start === -1 ? -1 : recordUuids.indexOf(tail, start);
  return start === -1 || end === -1 ? new Set<string>() : new Set(recordUuids.slice(start, end + 1));
}

export function createQoderTranslation({ retain }: { readonly retain: boolean }): QoderTranslation {
  const events: TranscriptEvent[] = [];
  const skipped: ParsedTranscript["skipped"] = [];
  const subagents = new Set<string>();
  /** The uuid of every parsed record, in file order: a compaction's preserved segment names the records it kept. */
  const recordUuids: string[] = [];
  /** The record uuid of each retained event, so the shadow pass does not parse the records again. */
  const eventUuids = new Map<TranscriptEvent, string>();
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
  ): TranscriptEvent | undefined =>
    pushRetainedEvent(events, retain, record, partIndex, body, definedFields({ ts, ...extra }));

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
      if (retain && parsed.uuid !== undefined) {
        recordUuids.push(parsed.uuid);
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
        const event = push(record, partIndex++, body, ts, { requestId, agentId });
        if (event !== undefined && parsed.uuid !== undefined) {
          eventUuids.set(event, parsed.uuid);
        }
        return event;
      };

      switch (parsed.type) {
        case "user": {
          const content = parsed.message?.content;
          const emitUserText = (text: string): void => {
            if (text !== "") {
              emit({
                kind: "user",
                payload: definedFields({
                  text,
                  ...(parsed.isMeta ? { meta: true } : {}),
                  ...(parsed.isCompactSummary ? { compactSummary: true } : {})
                })
              });
            }
          };
          if (typeof content === "string") {
            emitUserText(content);
          } else if (Array.isArray(content)) {
            for (const block of content) {
              if (block.type === "text") {
                emitUserText(block.text);
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
            const compaction = emit({ kind: "compaction", payload: compactionPayload(parsed.compactMetadata) });
            if (compaction !== undefined) {
              // A boundary that kept no messages replaces the whole context; one with a preserved segment keeps it.
              const keep = preservedUuids(recordUuids, parsed.compactMetadata);
              shadowBefore(events, compaction, (event) => {
                const uuid = eventUuids.get(event);
                return uuid !== undefined && keep?.has(uuid) === true;
              });
            }
          } else if (parsed.content !== undefined && parsed.content !== "") {
            emit({ kind: "system", payload: { type: parsed.subtype ?? "system", text: parsed.content } });
          }
          break;
        }
        case "attachment": {
          const attachment = parsed.attachment;
          const attachmentType = attachment?.type ?? "";
          if (attachment !== undefined && attachmentType.startsWith("hook_")) {
            emit({ kind: "hook", payload: hookPayload(attachmentType, attachment) });
          } else if (retain) {
            skipRecord(skipped, record, `attachment:${attachmentType || "record"}`);
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
      finalizeTranscriptEvents(events);
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
