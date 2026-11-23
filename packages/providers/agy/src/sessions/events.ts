import { definedFields } from "@rivus/agent-kit-catalog/spi";
import {
  baseEvent,
  finalizeTranscriptEvents,
  lineId,
  shadowBefore,
  skipRecord,
  type ParsedTranscript,
  type SourcedRecord,
  type TranscriptEvent,
  type TranscriptEventBody,
  type TranscriptSession
} from "@rivus/agent-kit-sessions/spi";
import {
  agyRecordTime,
  agyStepOf,
  agySubagentRoleOf,
  agySubagentSpawnedOf,
  agyUsageOf,
  type AgyToolCallRecord
} from "../records.js";
import { AGY_CAPABILITIES } from "./capabilities.js";

interface AgyStep {
  readonly ok: true;
  readonly parts: readonly TranscriptEventBody[];
}

/** A subagent conversation an `invoke_subagent` result on this lane created, and the call that created it. */
export interface AgySpawn {
  readonly conversationId: string;
  /** The `tool_call` event of the `invoke_subagent` call on this lane. */
  readonly spawnEventId: string;
  /** The call's `Role`. */
  readonly title?: string;
}

interface AgyPendingCall {
  readonly callId: string;
  readonly spawnEventId: string;
  readonly subagentTitle: string | undefined;
  readonly spawnsSubagent: boolean;
}

interface AgyTranslation {
  /** This lane's events; empty without retain. `finish` finalizes them in place. */
  readonly events: TranscriptEvent[];
  step(record: SourcedRecord): AgyStep;
  /** The subagent conversations this lane spawned, in the order their results arrived. */
  readonly spawns: ReadonlyMap<string, AgySpawn>;
  finish(session: TranscriptSession, agents: ParsedTranscript["agents"]): ParsedTranscript;
}

const INVOKE_SUBAGENT = "invoke_subagent";

export function createAgyTranslation({
  retain,
  laneId
}: {
  readonly retain: boolean;
  /** The lane these records belong to; a subagent lane's ids carry it, since lanes share file names and step indexes. */
  readonly laneId?: string;
}): AgyTranslation {
  const events: TranscriptEvent[] = [];
  const skipped: ParsedTranscript["skipped"] = [];
  const spawns = new Map<string, AgySpawn>();
  const pendingCalls: AgyPendingCall[] = [];
  const idPrefix = laneId === undefined ? "" : `${laneId}:`;

  // A subagent lane's ids carry the lane: the lanes' transcripts share file names and step indexes, so their event
  // and request ids would collide. `pushRetainedEvent` derives the id from the file alone, so the event is built here.
  const push = (
    record: SourcedRecord,
    partIndex: number,
    body: TranscriptEventBody,
    ts: number,
    requestId?: string
  ): TranscriptEvent | undefined => {
    if (!retain) {
      return undefined;
    }
    const event = baseEvent(
      record,
      body.kind,
      body.payload,
      definedFields({ id: `${idPrefix}${lineId(record, partIndex)}`, ts, requestId, agentId: laneId })
    );
    events.push(event);
    return event;
  };

  return {
    events,
    spawns,
    step(record: SourcedRecord): AgyStep {
      const step = agyStepOf(record.value);
      if (step === undefined) {
        if (retain) {
          skipRecord(skipped, record, "invalid-shape");
        }
        return { ok: true, parts: [] };
      }
      const ts = agyRecordTime(step) ?? 0;
      const parts: TranscriptEventBody[] = [];
      let partIndex = 0;
      const eventId = (): string => `${idPrefix}${lineId(record, partIndex)}`;
      const emit = (body: TranscriptEventBody, requestId?: string): TranscriptEvent | undefined => {
        parts.push(body);
        return push(record, partIndex++, body, ts, requestId);
      };

      const emitRequest = (): string | undefined => {
        const usage = agyUsageOf(step);
        if (usage === undefined && step.model === undefined) {
          return undefined;
        }
        const requestId =
          step.step_index !== undefined ? `${idPrefix}${step.step_index}` : `${idPrefix}${lineId(record, 0)}`;
        emit(
          { kind: "request", payload: definedFields({ granularity: "request" as const, model: step.model, usage }) },
          requestId
        );
        return requestId;
      };

      const emitToolCall = (toolCall: AgyToolCallRecord, callId: string, requestId: string | undefined): void => {
        const spawnsSubagent = toolCall.name === INVOKE_SUBAGENT;
        pendingCalls.push({
          callId,
          spawnEventId: eventId(),
          subagentTitle: spawnsSubagent ? agySubagentRoleOf(toolCall.args) : undefined,
          spawnsSubagent
        });
        emit(
          { kind: "tool_call", payload: definedFields({ callId, name: toolCall.name, args: toolCall.args }) },
          requestId
        );
      };

      switch (step.type) {
        case "USER_INPUT": {
          pendingCalls.length = 0;
          if (step.content !== undefined && step.content !== "") {
            emit({ kind: "user", payload: { text: step.content } });
          }
          break;
        }
        case "PLANNER_RESPONSE": {
          const stepKey = step.step_index ?? record.line;
          const requestId = emitRequest();
          if (step.thinking !== undefined && step.thinking !== "") {
            emit({ kind: "reasoning", payload: { text: step.thinking } }, requestId);
          }
          if (step.content !== undefined && step.content !== "") {
            emit({ kind: "assistant", payload: { text: step.content } }, requestId);
          }
          for (const [index, toolCall] of (step.tool_calls ?? []).entries()) {
            emitToolCall(toolCall, `${stepKey}:${index}`, requestId);
          }
          break;
        }
        case "GENERIC": {
          const call = pendingCalls.shift();
          if (call !== undefined) {
            const isError = step.status === "ERROR" || step.error !== undefined;
            emit({
              kind: "tool_result",
              payload: definedFields({
                callId: call.callId,
                output: step.content ?? step.error,
                ...(isError ? { isError: true } : {})
              })
            });
            if (call.spawnsSubagent) {
              const conversationId = agySubagentSpawnedOf(step.content ?? "");
              if (conversationId !== undefined && !spawns.has(conversationId)) {
                spawns.set(
                  conversationId,
                  definedFields({
                    conversationId,
                    spawnEventId: call.spawnEventId,
                    title: call.subagentTitle
                  })
                );
              }
            }
          } else if (step.content !== undefined && step.content !== "") {
            emit({ kind: "system", payload: { type: "generic", text: step.content } });
          }
          break;
        }
        case "CHECKPOINT": {
          pendingCalls.length = 0;
          const compaction = emit({
            kind: "compaction",
            payload: definedFields({ trigger: "auto" as const, summary: step.content })
          });
          if (compaction !== undefined) {
            shadowBefore(events, compaction);
          }
          emitRequest();
          break;
        }
        case "SYSTEM_MESSAGE": {
          if (step.content !== undefined && step.content !== "") {
            emit({ kind: "system", payload: { type: "system_message", text: step.content } });
          }
          break;
        }
        case "ERROR_MESSAGE": {
          const text = step.error ?? step.content;
          emit({ kind: "system", payload: definedFields({ type: "error", text }) });
          break;
        }
        default: {
          if (retain) {
            skipRecord(skipped, record, `unhandled-type:${step.type}`);
          }
          break;
        }
      }

      return { ok: true, parts };
    },

    finish(session, agents): ParsedTranscript {
      finalizeTranscriptEvents(events);
      return {
        session,
        agents,
        events,
        skipped
      };
    }
  };
}

export { AGY_CAPABILITIES };
