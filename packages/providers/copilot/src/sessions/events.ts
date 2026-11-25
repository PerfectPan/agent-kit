import { definedFields } from "@rivus/agent-kit-catalog/spi";
import {
  baseEvent,
  finalizeTranscriptEvents,
  lineId,
  shadowBefore,
  skipRecord,
  type Capability,
  type Lane,
  type ParsedTranscript,
  type SourcedRecord,
  type TranscriptEvent,
  type TranscriptEventBody,
  type TranscriptSession,
  type UnknownFormatGeneration
} from "@rivus/agent-kit-sessions/spi";
import { COPILOT_ID } from "../facts.js";
import {
  copilotAbortReasonOf,
  copilotAssistantMessageOf,
  copilotCompactionOf,
  copilotContentOf,
  copilotHookEndOf,
  copilotHookStartOf,
  copilotMessageOf,
  copilotRecordOf,
  copilotRecordTime,
  copilotResumeCwdOf,
  copilotSessionStartOf,
  copilotSubagentFailureOf,
  copilotSubagentStartOf,
  copilotToolEndOf,
  copilotToolStartOf,
  copilotUsageOf,
  copilotUserMessageOf,
  isSupportedCopilotVersion,
  type CopilotRequestUsage
} from "../records.js";
import { COPILOT_CAPABILITIES } from "./capabilities.js";

interface CopilotStepPart {
  readonly body: TranscriptEventBody;
  readonly mainLane: boolean;
}

type CopilotStep =
  | { readonly ok: true; readonly parts: readonly CopilotStepPart[] }
  | { readonly ok: false; readonly error: UnknownFormatGeneration };

interface CopilotTranslation {
  step(record: SourcedRecord, hasPreviousSegment?: boolean): CopilotStep;
  readonly subagentCount: number;
  readonly capabilities: readonly Capability[];
  finish(fallbackSessionId: string): ParsedTranscript;
}

function requestBodyOf(req: CopilotRequestUsage): TranscriptEventBody {
  return {
    kind: "request",
    payload: definedFields({
      granularity: "request" as const,
      model: req.model,
      provider: req.provider,
      requestId: req.requestId,
      responseId: req.responseId,
      usage: req.usage,
      durationMs: req.durationMs,
      finishReason: req.finishReason,
      modelCalls: req.modelCalls
    })
  };
}

export function createCopilotTranslation({ retain }: { readonly retain: boolean }): CopilotTranslation {
  const events: TranscriptEvent[] = [];
  const skipped: ParsedTranscript["skipped"] = [];
  const subagentLanes = new Map<string, Lane>();
  const toolCallEvents = new Map<string, string>();
  const pendingHooks = new Map<string, { readonly ts: number; readonly toolName?: string }>();
  const seenIds = new Set<string>();
  let sessionId: string | undefined;
  let cwd: string | undefined;
  let startedAt: number | undefined;
  let hasSystemPrompt = false;

  const ensureSubagentLane = (agentId: string, parentId?: string, spawnEventId?: string, title?: string): void => {
    const resolvedParent = parentId !== undefined && parentId !== "" && parentId !== agentId ? parentId : undefined;
    const existing = subagentLanes.get(agentId);
    if (existing !== undefined) {
      if (retain && (resolvedParent !== undefined || spawnEventId !== undefined || title !== undefined)) {
        subagentLanes.set(
          agentId,
          definedFields({
            id: agentId,
            parentId: resolvedParent ?? existing.parentId ?? COPILOT_ID,
            spawnEventId: spawnEventId ?? existing.spawnEventId,
            title: title ?? existing.title
          })
        );
      }
      return;
    }
    subagentLanes.set(
      agentId,
      definedFields({
        id: agentId,
        parentId: resolvedParent ?? COPILOT_ID,
        spawnEventId,
        title
      })
    );
  };

  return {
    get subagentCount(): number {
      return subagentLanes.size;
    },

    get capabilities(): readonly Capability[] {
      return hasSystemPrompt ? COPILOT_CAPABILITIES : COPILOT_CAPABILITIES.filter((c) => c !== "systemPrompt");
    },

    step(record: SourcedRecord, hasPreviousSegment = false): CopilotStep {
      const envelope = copilotRecordOf(record.value);
      if (envelope === undefined) {
        if (retain) {
          skipRecord(skipped, record, "invalid-shape");
        }
        return { ok: true, parts: [] };
      }

      // Skip checkpoint replays or duplicate record ids carried over from a rotated journal segment.
      if (
        (hasPreviousSegment && envelope.checkpoint === true) ||
        (envelope.id !== undefined && seenIds.has(envelope.id))
      ) {
        if (retain) {
          skipRecord(skipped, record, "journal-replay");
        }
        return { ok: true, parts: [] };
      }
      if (envelope.id !== undefined) {
        seenIds.add(envelope.id);
      }

      const ts = copilotRecordTime(envelope) ?? 0;
      const laneId =
        envelope.agentId !== undefined && envelope.agentId !== "" && envelope.agentId !== COPILOT_ID
          ? envelope.agentId
          : undefined;
      if (laneId !== undefined) {
        ensureSubagentLane(laneId);
      }
      const mainLane = laneId === undefined;
      const parts: CopilotStepPart[] = [];
      let partIndex = 0;

      const emit = (body: TranscriptEventBody, requestId?: string): TranscriptEvent | undefined => {
        parts.push({ body, mainLane });
        const id = lineId(record, partIndex++);
        if (!retain) {
          return undefined;
        }
        const event = baseEvent(record, body.kind, body.payload, definedFields({ id, ts, requestId, agentId: laneId }));
        events.push(event);
        return event;
      };

      let emitted = false;
      switch (envelope.type) {
        case "session.start": {
          const start = copilotSessionStartOf(envelope);
          if (!isSupportedCopilotVersion(start?.version)) {
            return {
              ok: false,
              error: {
                _tag: "UnknownFormatGeneration",
                agent: COPILOT_ID,
                file: record.file,
                line: record.line
              }
            };
          }
          if (start?.sessionId !== undefined && start.sessionId !== "") {
            sessionId = start.sessionId;
          }
          if (start?.cwd !== undefined && start.cwd !== "") {
            cwd = start.cwd;
          }
          if (ts > 0 && startedAt === undefined) {
            startedAt = ts;
          }
          break;
        }
        case "session.resume": {
          const resumed = copilotResumeCwdOf(envelope);
          if (resumed !== undefined && resumed !== "") {
            cwd = resumed;
          }
          break;
        }
        case "system.message": {
          const content = copilotContentOf(envelope);
          if (content !== undefined && content !== "") {
            hasSystemPrompt = true;
            emit({ kind: "system", payload: { type: "prompt_snapshot", systemPrompt: content } });
            emitted = true;
          }
          break;
        }
        case "user.message": {
          const msg = copilotUserMessageOf(envelope);
          if (msg !== undefined) {
            const text = msg.content !== undefined && msg.content !== "" ? msg.content : undefined;
            if (text !== undefined || msg.hasAttachments || msg.hasSubmittedTask) {
              const injected = msg.source !== undefined || msg.isAutopilotContinuation === true;
              emit({
                kind: "user",
                payload: definedFields({
                  text,
                  injected: injected ? true : undefined
                })
              });
              emitted = true;
            }
          }
          break;
        }
        case "session.usage_record": {
          const req = copilotUsageOf(envelope);
          if (req !== undefined && (req.usage !== undefined || req.model !== undefined)) {
            emit(requestBodyOf(req), req.requestId);
            emitted = true;
          }
          break;
        }
        case "assistant.message": {
          const msg = copilotAssistantMessageOf(envelope);
          if (msg !== undefined) {
            if (msg.reasoningText !== undefined && msg.reasoningText !== "") {
              emit({ kind: "reasoning", payload: { text: msg.reasoningText } }, msg.requestId);
              emitted = true;
            } else if (msg.reasoningOpaque === true) {
              emit({ kind: "reasoning", payload: { redacted: true } }, msg.requestId);
              emitted = true;
            }
            if (msg.content !== undefined && msg.content !== "") {
              emit({ kind: "assistant", payload: { text: msg.content } }, msg.requestId);
              emitted = true;
            }
          }
          break;
        }
        case "tool.execution_start": {
          const start = copilotToolStartOf(envelope);
          if (start?.callId !== undefined && start.name !== undefined) {
            const event = emit({
              kind: "tool_call",
              payload: definedFields({
                callId: start.callId,
                name: start.name,
                title: start.title !== undefined && start.title !== start.name ? start.title : undefined,
                args: start.args
              })
            });
            if (retain && event !== undefined) {
              toolCallEvents.set(start.callId, event.id);
            }
            emitted = true;
          }
          break;
        }
        case "tool.execution_complete": {
          const end = copilotToolEndOf(envelope);
          if (end?.callId !== undefined) {
            const isError =
              end.success === false || end.error !== undefined || (end.exitCode !== undefined && end.exitCode !== 0);
            emit({
              kind: "tool_result",
              payload: definedFields({
                callId: end.callId,
                output: end.output,
                isError: isError ? true : undefined,
                exitCode: end.exitCode
              })
            });
            emitted = true;
          }
          break;
        }
        case "session.compaction_complete": {
          const comp = copilotCompactionOf(envelope);
          if (comp !== undefined) {
            if (comp.success !== false) {
              const compaction = emit({
                kind: "compaction",
                payload: definedFields({
                  trigger: comp.trigger === "manual" ? ("manual" as const) : ("auto" as const),
                  preTokens: comp.preTokens,
                  postTokens: comp.postTokens,
                  summary: comp.summary
                })
              });
              if (compaction !== undefined) {
                shadowBefore(events, compaction);
              }
              emitted = true;
            }
            if (comp.tokens !== undefined && (comp.tokens.usage !== undefined || comp.tokens.model !== undefined)) {
              emit(
                requestBodyOf({
                  ...comp.tokens,
                  requestId: comp.tokens.requestId ?? comp.attemptId,
                  responseId: comp.tokens.responseId ?? comp.responseId
                }),
                comp.tokens.requestId ?? comp.attemptId
              );
              emitted = true;
            }
          }
          break;
        }
        case "hook.start": {
          const start = copilotHookStartOf(envelope);
          if (start?.invocationId !== undefined) {
            pendingHooks.set(start.invocationId, definedFields({ ts, toolName: start.toolName }));
          }
          break;
        }
        case "hook.end": {
          const end = copilotHookEndOf(envelope);
          if (end !== undefined) {
            const start = end.invocationId === undefined ? undefined : pendingHooks.get(end.invocationId);
            if (end.invocationId !== undefined) {
              pendingHooks.delete(end.invocationId);
            }
            const durationMs = start !== undefined && start.ts > 0 && ts >= start.ts ? ts - start.ts : undefined;
            emit({
              kind: "hook",
              payload: definedFields({
                type: "hook_end",
                event: end.type,
                name: start?.toolName,
                error: end.error,
                durationMs
              })
            });
            emitted = true;
          }
          break;
        }
        case "subagent.started": {
          const start = copilotSubagentStartOf(envelope);
          if (laneId !== undefined) {
            const spawnEventId = start?.callId === undefined ? undefined : toolCallEvents.get(start.callId);
            ensureSubagentLane(laneId, start?.parentId, spawnEventId, start?.title);
          }
          break;
        }
        case "subagent.failed": {
          const failure = copilotSubagentFailureOf(envelope);
          if (failure?.error !== undefined && failure.error !== "") {
            emit({ kind: "system", payload: { type: "subagent_error", text: failure.error } });
            emitted = true;
          }
          break;
        }
        case "abort": {
          const reason = copilotAbortReasonOf(envelope);
          emit({ kind: "system", payload: definedFields({ type: "abort", text: reason }) });
          emitted = true;
          break;
        }
        case "session.error":
        case "session.warning": {
          const text = copilotMessageOf(envelope);
          emit({
            kind: "system",
            payload: definedFields({
              type: envelope.type === "session.error" ? "error" : "warning",
              text
            })
          });
          emitted = true;
          break;
        }
        default:
          break;
      }

      if (!emitted && retain) {
        skipRecord(skipped, record, envelope.type);
      }

      return { ok: true, parts };
    },

    finish(fallbackSessionId: string): ParsedTranscript {
      finalizeTranscriptEvents(events);
      const session: TranscriptSession = definedFields({
        id: sessionId ?? fallbackSessionId,
        cwd,
        startedAt
      });
      return {
        session,
        agents: [{ id: COPILOT_ID }, ...subagentLanes.values()],
        events,
        skipped
      };
    }
  };
}

export { COPILOT_CAPABILITIES };
