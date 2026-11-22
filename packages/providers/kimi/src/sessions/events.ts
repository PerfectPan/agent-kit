import { definedFields } from "@rivus/agent-kit-catalog/spi";
import {
  baseEvent,
  finalizeTranscriptEvents,
  OUTPUT_KINDS,
  placeRequest,
  skipRecord,
  type ParsedTranscript,
  type SourcedRecord,
  type TranscriptEvent,
  type TranscriptEventBody,
  type TranscriptSession,
  type UnknownFormatGeneration,
  unknownFormatGeneration
} from "@rivus/agent-kit-sessions/spi";
import { KIMI_ID } from "../facts.js";
import {
  kimiAppendMessageOf,
  kimiApplyCompactionOf,
  kimiCompactionSummaryText,
  kimiLoopEventOf,
  kimiProfileBindOf,
  kimiSubagentSpawnedOf,
  kimiTurnEndedOf,
  kimiTurnPromptOf,
  kimiContentText,
  kimiUsageOf
} from "../records.js";

// The wire's record stream becomes the kit's flat event list: appended messages become user events (the agent's own
// `<system-reminder>` injections carry `injected`, a blocked hook's result becomes a hook event), loop events become
// reasoning, assistant text, tool calls and results, and a finished step becomes the request of the model call that
// produced the step's output, with the usage the step reports. `context.apply_compaction` marks the point where the
// agent reset its context to the summary (older wire lines stay in the file but out of the model's context, so the
// post-pass shadows the lane's earlier events), and `subagent.spawned` names the subagent whose own wire is the lane.
// Times ride the records' `time` field; `inheritTimes` fills the gaps.

export interface KimiStep {
  ok: boolean;
  /** The bodies the record produced; empty for bookkeeping records the transcript never shows. */
  parts: readonly TranscriptEventBody[];
}

/** The bodies one record produces, with the `request` placed after its step's output in retain mode. */
type StepResult = { generation?: true } | { parts: readonly TranscriptEventBody[] };

function definedRequestFields(ts: number, requestId: string | undefined) {
  return requestId === undefined ? { ts } : { ts, requestId };
}

function createKimiTranslationInner({ retain }: { readonly retain: boolean }) {
  const events: TranscriptEvent[] = [];
  const skipped: ParsedTranscript["skipped"] = [];
  const turnPrompts = new Map<string, string>();
  /** The subagent a `subagent.spawned` record names, pointing at the system event that records the spawn. */
  const spawns = new Map<string, string>();
  let tools: unknown;
  let systemPrompt: string | undefined;
  let generation: SourcedRecord | undefined;

  const translate = (record: SourcedRecord, ts: number): StepResult => {
    const value = record.value;
    if (typeof value !== "object" || value === null || typeof (value as Record<string, unknown>)["type"] !== "string") {
      if (retain) {
        skipRecord(skipped, record, "invalid-shape");
      }
      return { parts: [] };
    }
    const type = (value as Record<string, unknown>)["type"] as string;
    const emitOne = (body: TranscriptEventBody): { readonly parts: TranscriptEventBody[] } => {
      if (retain) {
        events.push(baseEvent(record, body.kind, body.payload, { ts }));
      }
      return { parts: [body] };
    };
    switch (type) {
      case "metadata": {
        const version = (value as Record<string, unknown>)["protocol_version"];
        if (typeof version !== "string" || !version.startsWith("1.")) {
          generation = record;
          return { generation: true };
        }
        return { parts: [] };
      }
      case "turn.prompt": {
        const prompt = kimiTurnPromptOf(value);
        if (prompt === undefined) {
          if (retain) {
            skipRecord(skipped, record, "invalid-turn-prompt");
          }
          return { parts: [] };
        }
        turnPrompts.set(String(prompt.turnId), prompt.promptId);
        return { parts: [] };
      }
      case "context.append_message": {
        const appended = kimiAppendMessageOf(value);
        const message = appended?.message;
        if (message === undefined) {
          if (retain) {
            skipRecord(skipped, record, "invalid-message");
          }
          return { parts: [] };
        }
        const text = kimiContentText(message.content);
        if (message.origin?.kind === "hook_result") {
          // A hook's verdict rides an appended message; the kit models it as the hook event, not as model output.
          return emitOne({
            kind: "hook",
            payload: definedFields({
              type: "hook_result",
              ...(message.origin.event !== undefined ? { event: message.origin.event } : {}),
              ...(message.origin.blocked === true ? { blocked: true } : {})
            })
          });
        }
        if (message.role === "user") {
          if (text === undefined && message.origin?.kind !== "injection") {
            return { parts: [] };
          }
          return emitOne({
            kind: "user",
            payload: {
              ...(text !== undefined ? { text } : {}),
              ...(message.origin?.kind === "injection" ? { injected: true } : {})
            }
          });
        }
        if (message.role === "assistant" && text !== undefined) {
          return emitOne({ kind: "assistant", payload: { text } });
        }
        return { parts: [] };
      }
      case "context.append_loop_event": {
        const loop = kimiLoopEventOf((value as Record<string, unknown>)["event"]);
        if (loop === undefined) {
          if (retain) {
            skipRecord(skipped, record, "invalid-loop-event");
          }
          return { parts: [] };
        }
        switch (loop.type) {
          case "content.part": {
            if (loop.part?.type === "think") {
              const think = loop.part.think;
              if (think === undefined || think === "") {
                return { parts: [] };
              }
              return emitOne({ kind: "reasoning", payload: { text: think } });
            }
            const text = loop.part?.type === "text" ? loop.part.text : undefined;
            if (text === undefined || text === "") {
              return { parts: [] };
            }
            return emitOne({ kind: "assistant", payload: { text } });
          }
          case "tool.call": {
            if (loop.toolCallId === undefined || loop.name === undefined) {
              return { parts: [] };
            }
            return emitOne({
              kind: "tool_call",
              payload: { callId: loop.toolCallId, name: loop.name, args: loop.args }
            });
          }
          case "tool.result": {
            if (loop.toolCallId === undefined) {
              return { parts: [] };
            }
            return emitOne({
              kind: "tool_result",
              payload: { callId: loop.toolCallId, output: loop.result?.output, isError: loop.result?.isError === true }
            });
          }
          case "step.end": {
            const usage = kimiUsageOf(loop.usage ?? {});
            if (usage === undefined) {
              return { parts: [] };
            }
            // One model call, one id: the step's own uuid, with the turn's prompt id kept beside it in the payload.
            const requestId =
              loop.uuid ?? (loop.turnId === undefined ? undefined : turnPrompts.get(String(loop.turnId)));
            const body: TranscriptEventBody = {
              kind: "request",
              payload: {
                ...(loop.messageId !== undefined ? { responseId: loop.messageId } : {}),
                ...(loop.finishReason !== undefined ? { finishReason: loop.finishReason } : {}),
                ...(requestId !== undefined && turnPrompts.has(String(loop.turnId))
                  ? { promptId: turnPrompts.get(String(loop.turnId)) }
                  : {}),
                usage,
                granularity: "request"
              }
            };
            if (retain) {
              const event = baseEvent(record, body.kind, body.payload, definedRequestFields(ts, requestId));
              // The request sits before the step's own output: past the previous request and the outputs it
              // already owns, so an earlier step's events stay its own.
              let anchor = 0;
              for (let index = events.length - 1; index >= 0; index--) {
                if (events[index]!.kind === "request") {
                  anchor = index + 1;
                  break;
                }
              }
              while (anchor < events.length && OUTPUT_KINDS.has(events[anchor]!.kind)) {
                anchor += 1;
              }
              placeRequest(events, anchor, event);
              // The skip moved `from` past this step's own outputs, so `placeRequest` stamped none of them; stamp
              // the output run the request closes, back to the previous request or the turn's start.
              if (event.requestId !== undefined) {
                const at = events.lastIndexOf(event);
                for (let index = at - 1; index >= 0 && OUTPUT_KINDS.has(events[index]!.kind); index--) {
                  if (events[index]!.requestId === undefined) {
                    events[index]!.requestId = event.requestId;
                  }
                }
              }
            }
            return { parts: [body] };
          }
          default:
            return { parts: [] };
        }
      }
      case "context.apply_compaction": {
        const compaction = kimiApplyCompactionOf(value);
        if (compaction === undefined) {
          if (retain) {
            skipRecord(skipped, record, "invalid-compaction");
          }
          return { parts: [] };
        }
        const summary = kimiCompactionSummaryText(compaction.summary, compaction.contextSummary);
        return emitOne({
          kind: "compaction",
          payload: definedFields({
            ...(compaction.tokensBefore !== undefined ? { preTokens: compaction.tokensBefore } : {}),
            ...(compaction.tokensAfter !== undefined ? { postTokens: compaction.tokensAfter } : {}),
            ...(summary !== undefined ? { summary } : {})
          })
        });
      }
      case "subagent.spawned": {
        const spawned = kimiSubagentSpawnedOf(value);
        if (spawned === undefined) {
          if (retain) {
            skipRecord(skipped, record, "invalid-spawned");
          }
          return { parts: [] };
        }
        const body: TranscriptEventBody = {
          kind: "system",
          payload: definedFields({
            type: "subagent",
            agentId: spawned.subagentId,
            name: spawned.subagentName,
            ...(spawned.description !== undefined ? { description: spawned.description } : {}),
            ...(spawned.runInBackground === true ? { runInBackground: true } : {})
          })
        };
        if (retain) {
          const event = baseEvent(record, body.kind, body.payload, { ts });
          spawns.set(spawned.subagentId, event.id);
          events.push(event);
        }
        return { parts: [body] };
      }
      case "turn.ended": {
        const ended = kimiTurnEndedOf(value);
        if (ended?.durationMs === undefined) {
          return { parts: [] };
        }
        return emitOne({ kind: "system", payload: { type: "turn_duration", durationMs: ended.durationMs } });
      }
      case "llm.tools_snapshot": {
        const snapshot = value as Record<string, unknown>;
        if (Array.isArray(snapshot["tools"])) {
          tools = snapshot["tools"];
        }
        return { parts: [] };
      }
      case "profile.bind": {
        const profile = kimiProfileBindOf(value);
        if (profile?.systemPrompt === undefined) {
          return { parts: [] };
        }
        systemPrompt = profile.systemPrompt;
        return emitOne({ kind: "system", payload: { type: "prompt_snapshot", systemPrompt: profile.systemPrompt } });
      }
      default:
        return { parts: [] };
    }
  };

  return {
    events,
    skipped,
    step(record: SourcedRecord, ts: number): KimiStep {
      const result = translate(record, ts);
      if ("generation" in result || !("parts" in result)) {
        return { ok: false, parts: [] };
      }
      // A record that became no event is bookkeeping the transcript never shows; the skipped list accounts for it.
      if (retain && result.parts.length === 0) {
        skipRecord(skipped, record, "bookkeeping");
      }
      return { ok: true, parts: result.parts };
    },
    spawns: retain ? spawns : new Map<string, string>(),
    finish(session: TranscriptSession, agents: ParsedTranscript["agents"]): ParsedTranscript {
      finalizeTranscriptEvents(events);
      return {
        events,
        skipped,
        session: definedFields({
          ...session,
          ...(tools !== undefined ? { tools } : {}),
          ...(systemPrompt !== undefined ? { systemPrompt } : {})
        }),
        agents: agents.length > 0 ? agents : [{ id: KIMI_ID }]
      };
    },
    generationError(): UnknownFormatGeneration | undefined {
      return generation === undefined ? undefined : unknownFormatGeneration(KIMI_ID, generation);
    }
  };
}

interface KimiRetainedTranslation {
  /** This lane's events; `finish` finalizes them in place. */
  readonly events: TranscriptEvent[];
  readonly skipped: ParsedTranscript["skipped"];
  step(record: SourcedRecord, ts: number): KimiStep;
  finish(session: TranscriptSession, agents: ParsedTranscript["agents"]): ParsedTranscript;
  /** The subagent each `subagent.spawned` record names, pointing at its spawn event on this lane. */
  readonly spawns: ReadonlyMap<string, string>;
  generationError(): UnknownFormatGeneration | undefined;
}

export function createKimiTranslation(options: { readonly retain: true }): KimiRetainedTranslation;
export function createKimiTranslation(options: { readonly retain: false }): {
  step(record: SourcedRecord): KimiStep;
};
export function createKimiTranslation(options: {
  readonly retain: boolean;
}): KimiRetainedTranslation | { step(record: SourcedRecord): KimiStep } {
  const inner = createKimiTranslationInner(options);
  if (options.retain) {
    return inner;
  }
  return {
    step(record: SourcedRecord): KimiStep {
      return inner.step(record, 0);
    }
  };
}
