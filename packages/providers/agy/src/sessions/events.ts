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
  type SourcedRecord,
  type TranscriptEvent,
  type TranscriptEventBody,
  type TranscriptSession
} from "@rivus/agent-kit-sessions/spi";
import { agyRecordTime, agyStepOf, agyUsageOf } from "../records.js";
import { AGY_CAPABILITIES } from "./capabilities.js";

interface AgyStep {
  readonly ok: true;
  readonly parts: readonly TranscriptEventBody[];
}

interface AgyTranslation {
  step(record: SourcedRecord): AgyStep;
  finish(session: TranscriptSession, agents: ParsedTranscript["agents"]): ParsedTranscript;
}

export function createAgyTranslation({ retain }: { readonly retain: boolean }): AgyTranslation {
  const events: TranscriptEvent[] = [];
  const skipped: ParsedTranscript["skipped"] = [];
  const pendingCalls: string[] = [];

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
    const id = lineId(record, partIndex);
    const event = baseEvent(
      record,
      body.kind,
      body.payload,
      requestId === undefined ? { id, ts } : { id, ts, requestId }
    );
    events.push(event);
    return event;
  };

  return {
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
      const emit = (body: TranscriptEventBody, requestId?: string): TranscriptEvent | undefined => {
        parts.push(body);
        return push(record, partIndex++, body, ts, requestId);
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
          const usage = agyUsageOf(step);
          const stepKey = step.step_index ?? record.line;
          let requestId: string | undefined;
          if (usage !== undefined || step.model !== undefined) {
            requestId = step.step_index !== undefined ? String(step.step_index) : lineId(record, 0);
            emit(
              {
                kind: "request",
                payload: definedFields({
                  granularity: "request" as const,
                  model: step.model,
                  usage
                })
              },
              requestId
            );
          }
          if (step.thinking !== undefined && step.thinking !== "") {
            emit({ kind: "reasoning", payload: { text: step.thinking } }, requestId);
          }
          if (step.content !== undefined && step.content !== "") {
            emit({ kind: "assistant", payload: { text: step.content } }, requestId);
          }
          for (const [index, toolCall] of (step.tool_calls ?? []).entries()) {
            const callId = `${stepKey}:${index}`;
            pendingCalls.push(callId);
            emit(
              { kind: "tool_call", payload: definedFields({ callId, name: toolCall.name, args: toolCall.args }) },
              requestId
            );
          }
          break;
        }
        case "GENERIC": {
          const callId = pendingCalls.shift();
          if (callId !== undefined) {
            const isError = step.status === "ERROR" || step.error !== undefined;
            emit({
              kind: "tool_result",
              payload: definedFields({
                callId,
                output: step.content ?? step.error,
                ...(isError ? { isError: true } : {})
              })
            });
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
          const usage = agyUsageOf(step);
          if (usage !== undefined || step.model !== undefined) {
            const requestId = step.step_index !== undefined ? String(step.step_index) : lineId(record, 0);
            emit(
              {
                kind: "request",
                payload: definedFields({ granularity: "request" as const, model: step.model, usage })
              },
              requestId
            );
          }
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
      const times = inheritTimes(events.map((event) => (event.ts > 0 ? event.ts : undefined)));
      for (const [index, event] of events.entries()) {
        event.ts = times[index]!;
      }
      markOrphanToolResults(events);
      assignSeq(events);
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
