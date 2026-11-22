import { type Result, err, ok } from "@rivus/agent-kit-catalog/spi";
import {
  type Capability,
  type MessagePayload,
  type ParsedTranscript,
  type RequestPayload,
  type SourcedRecord,
  type TranscriptEvent,
  type TranscriptEventBody,
  type RecordTranslation,
  baseEvent,
  createTranslationBuffer,
  detectEventCapabilities,
  joinedPartText,
  lineId,
  type UnknownFormatGeneration,
  unknownFormatGeneration
} from "@rivus/agent-kit-sessions/spi";

import { DSH_ID, DSH_SESSION_VERSION } from "../facts.js";
import {
  type DshMessageValue,
  dshAssistantOf,
  dshCompactionOf,
  dshContentParts,
  dshEventOf,
  dshHeaderOf,
  dshMessageDataOf,
  dshRequestHeaderOf,
  dshStepBoundaryOf,
  dshStreamTimeRange,
  dshTitleOf,
  dshUsageOf,
  dshUserMessageOf
} from "../records.js";

/** Everything a DeepSeek Harness session can record. A transcript lists the subset its own log shows. */
export const DSH_CAPABILITIES: readonly Capability[] = [
  "requests",
  "usage",
  "durations",
  "reasoning",
  "compaction",
  "compactionTokens",
  "systemPrompt",
  "toolSchemas"
];

/** What one translated session can show, from the events and session fields it produced. */
export function dshCapabilities(parsed: ParsedTranscript): Capability[] {
  const out = detectEventCapabilities(parsed.events);
  if (parsed.events.some((event) => event.kind === "request" && event.payload.durationMs !== undefined)) {
    out.push("durations");
  }
  if (parsed.session.systemPrompt !== undefined) {
    out.push("systemPrompt");
  }
  if (parsed.session.tools !== undefined) {
    out.push("toolSchemas");
  }
  return out;
}

/** Event types that are harness bookkeeping, not transcript content. */
const BOOKKEEPING = new Set([
  "turn/start",
  "turn/end",
  "request/context",
  "tool/call",
  "session/end-seed",
  "assistant/attempt",
  "agent/inbox/spliced",
  "subagent/catalog",
  "compaction/start",
  "compaction/end",
  "permission/preset",
  "sandbox/mode",
  "approval/policy",
  "command/run",
  "command/done",
  "goal/change",
  "job/registered",
  "job/settled",
  "web/deepseek-search-llm-request",
  "session/title-llm-request"
]);

export interface DshTranslationOptions {
  readonly retain: boolean;
  readonly sessionId?: string;
}

export type DshTranslation = RecordTranslation;

function hasImage(parts: readonly { kind: string }[]): boolean {
  return parts.some((part) => part.kind === "image");
}

/** A user message's payload: human prompts stay prompts, injected context and compaction checkpoints are flagged. */
function userPayload(message: DshMessageValue): MessagePayload {
  const parts = dshContentParts(message.content);
  const text = joinedPartText(parts);
  const source = message.source?.kind;
  return {
    ...(text ? { text } : {}),
    ...(hasImage(parts) ? { image: true } : {}),
    ...(source === undefined || source === "user" ? {} : { injected: true }),
    ...(source === "compact-checkpoint" ? { compactSummary: true, injected: false } : {})
  };
}

function stepKey(turn: number | undefined, step: number | undefined): string | undefined {
  if (turn === undefined || step === undefined || !Number.isFinite(turn) || !Number.isFinite(step)) {
    return undefined;
  }
  return `${turn}:${step}`;
}

/** One harness session log into transcript events. */
export function createDshTranslation(options: DshTranslationOptions): DshTranslation {
  const buffer = createTranslationBuffer(options.retain);
  const seqLines = new Map<number, number>();
  const stepStarts = new Map<string, number>();
  let unkeyedStepStart: number | undefined;
  let header: ReturnType<typeof dshHeaderOf>;
  let title: string | undefined;
  let systemPrompt: string | undefined;
  let tools: readonly unknown[] | undefined;
  let model: string | undefined;
  let first = true;

  function shadow(seqs: readonly number[] | undefined, compaction: TranscriptEvent): void {
    if (!options.retain || seqs === undefined) {
      return;
    }
    const lines = new Set<number>();
    for (const seq of seqs) {
      const line = seqLines.get(seq);
      if (line !== undefined) {
        lines.add(line);
      }
    }
    for (const event of buffer.events) {
      if (
        event !== compaction &&
        event.kind !== "compaction" &&
        event.shadowedBy === undefined &&
        lines.has(event.source.line)
      ) {
        event.shadowedBy = compaction.id;
      }
    }
  }

  function emitAssistant(record: SourcedRecord, ts: number, data: unknown): void {
    const assistant = dshAssistantOf(data);
    const message = assistant?.message;
    const usage = dshUsageOf(assistant?.usage);
    const key = stepKey(assistant?.turn, assistant?.step);
    let stepStart: number | undefined;
    if (key !== undefined) {
      stepStart = stepStarts.get(key);
      stepStarts.delete(key);
    } else {
      stepStart = unkeyedStepStart;
      unkeyedStepStart = undefined;
    }
    const streamRange = dshStreamTimeRange(assistant?.stream);
    let durationMs: number | undefined;
    if (streamRange !== undefined) {
      const start = stepStart ?? streamRange.first;
      const end = streamRange.last;
      if (Number.isFinite(start) && Number.isFinite(end) && end >= start) {
        durationMs = end - start;
      }
    }
    const requestId = lineId(record, 0);
    const requestKey = `request:${requestId}`;
    const request: RequestPayload = {
      granularity: "request",
      ...(message?.source?.model === undefined && model === undefined
        ? {}
        : { model: message?.source?.model ?? model }),
      ...(message?.id === undefined ? {} : { responseId: message.id }),
      ...(usage === undefined ? {} : { usage }),
      ...(durationMs === undefined ? {} : { durationMs })
    };
    buffer.emit(baseEvent(record, "request", request, { id: requestId, ts, requestId: requestKey }));
    let index = 1;
    const emitPart = (body: TranscriptEventBody): void => {
      buffer.emit(
        baseEvent(record, body.kind, body.payload, { id: lineId(record, index++), ts, requestId: requestKey })
      );
    };
    for (const part of dshContentParts(message?.content)) {
      if (part.kind === "text") {
        emitPart({ kind: "assistant", payload: { text: part.text } });
      } else if (part.kind === "reasoning") {
        emitPart({ kind: "reasoning", payload: { text: part.text } });
      } else if (part.kind === "tool_call") {
        emitPart({ kind: "tool_call", payload: { callId: part.id, name: part.name, args: part.args } });
      } else if (part.kind === "image") {
        emitPart({ kind: "assistant", payload: { image: true } });
      } else {
        emitPart({ kind: "unknown", payload: { type: part.type } });
      }
    }
  }

  function emitCompaction(record: SourcedRecord, ts: number, data: unknown): ReturnType<typeof dshCompactionOf> {
    const compaction = dshCompactionOf(data);
    const eventValue = baseEvent(
      record,
      "compaction",
      {
        ...(compaction?.shadowedTokenCount === undefined ? {} : { preTokens: compaction.shadowedTokenCount }),
        ...(compaction?.summary === undefined ? {} : { summary: compaction.summary })
      },
      { ts }
    );
    buffer.emit(eventValue);
    shadow(compaction?.shadowedSeqs, eventValue);
    return compaction;
  }

  function step(record: SourcedRecord, ts: number): Result<readonly TranscriptEvent[], UnknownFormatGeneration> {
    const parts = buffer.beginStep();
    const event = dshEventOf(record.value);
    if (event === undefined) {
      return err(unknownFormatGeneration(DSH_ID, record));
    }
    const headerValue = dshHeaderOf(record.value);
    if (headerValue !== undefined) {
      if (headerValue.version !== DSH_SESSION_VERSION) {
        return err(unknownFormatGeneration(DSH_ID, record));
      }
      if (header === undefined) {
        header = headerValue;
        buffer.noteTime(headerValue.createdAt ?? ts);
        first = false;
      }
      buffer.skip(record, "session-header");
      return ok(parts);
    }
    if (first) {
      return err(unknownFormatGeneration(DSH_ID, record));
    }
    if (event.seq !== undefined) {
      seqLines.set(event.seq, record.line);
    }
    buffer.noteTime(event.time ?? ts);
    switch (event.type) {
      case "user/message": {
        const message = dshUserMessageOf(event.data);
        if (message === undefined) {
          buffer.skip(record, "user-message-without-body");
          break;
        }
        buffer.emit(baseEvent(record, "user", userPayload(message), { ts }));
        break;
      }
      case "assistant/message":
        emitAssistant(record, ts, event.data);
        break;
      case "tool/result": {
        const message = dshMessageDataOf(event.data);
        if (message === undefined) {
          buffer.skip(record, "tool-result-without-body");
          break;
        }
        const content = joinedPartText(dshContentParts(message.content));
        buffer.emit(
          baseEvent(
            record,
            "tool_result",
            {
              callId: message.toolCallId ?? "",
              ...(content ? { output: content } : {}),
              ...(message.isError === true ? { isError: true } : {})
            },
            { ts }
          )
        );
        break;
      }
      case "system/message": {
        const message = dshMessageDataOf(event.data);
        const text = message === undefined ? "" : joinedPartText(dshContentParts(message.content));
        if (text) {
          systemPrompt = text;
        }
        buffer.emit(baseEvent(record, "system", { type: "system", ...(text ? { text } : {}) }, { ts }));
        break;
      }
      case "developer/message": {
        const message = dshMessageDataOf(event.data);
        const text = message === undefined ? "" : joinedPartText(dshContentParts(message.content));
        buffer.emit(
          baseEvent(record, "system", { type: "developer", ...(text ? { text } : {}), injected: true }, { ts })
        );
        break;
      }
      case "request/header": {
        const parsed = dshRequestHeaderOf(event.data);
        model = parsed?.config?.model;
        if (parsed?.tools !== undefined) {
          tools = parsed.tools;
        }
        buffer.emit(
          baseEvent(
            record,
            "system",
            {
              type: "prompt_snapshot",
              ...(parsed?.config?.provider === undefined ? {} : { provider: parsed.config.provider }),
              ...(parsed?.config?.model === undefined ? {} : { model: parsed.config.model }),
              ...(parsed?.tools === undefined ? {} : { tools: [...parsed.tools] })
            },
            { ts }
          )
        );
        break;
      }
      case "compaction/prune": {
        emitCompaction(record, ts, event.data);
        break;
      }
      case "compaction/summary": {
        const compaction = emitCompaction(record, ts, event.data);
        // The summarization call never goes through the agent loop, so its usage rides on the event itself; count it
        // as its own request, as the usage decoder does, so the summary's totals and the usage totals agree. A prune
        // records no model call and never carries usage, so it produces no request.
        const usage = dshUsageOf(compaction?.usage);
        if (usage !== undefined) {
          const id = lineId(record, 1);
          const request: RequestPayload = {
            granularity: "request",
            ...(compaction?.model === undefined ? {} : { model: compaction.model }),
            usage
          };
          buffer.emit(baseEvent(record, "request", request, { id, ts, requestId: `request:${id}` }));
        }
        break;
      }
      case "step/start": {
        if (event.time !== undefined && Number.isFinite(event.time)) {
          const boundary = dshStepBoundaryOf(event.data);
          const key = stepKey(boundary?.turn, boundary?.step);
          if (key !== undefined) {
            stepStarts.set(key, event.time);
          } else {
            unkeyedStepStart = event.time;
          }
        }
        buffer.skip(record, event.type);
        break;
      }
      case "step/end": {
        const boundary = dshStepBoundaryOf(event.data);
        const key = stepKey(boundary?.turn, boundary?.step);
        if (key !== undefined) {
          stepStarts.delete(key);
        } else {
          unkeyedStepStart = undefined;
        }
        buffer.skip(record, event.type);
        break;
      }
      case "session/title": {
        title = dshTitleOf(event.data);
        buffer.skip(record, "session-title");
        break;
      }
      default:
        if (BOOKKEEPING.has(event.type)) {
          buffer.skip(record, event.type);
        } else {
          // A type outside the bookkeeping set is content the harness recorded that this reader does not
          // understand: like pi, codex and claude-code, it becomes an `unknown` event instead of vanishing, so a
          // future harness event type stays visible in transcripts.
          buffer.emit(baseEvent(record, "unknown", { type: event.type }, { ts }));
        }
        break;
    }
    return ok(parts);
  }

  return {
    events: buffer.events,
    skipped: buffer.skipped,
    step,
    finish: () =>
      buffer.finish(
        buffer.session(
          { id: header?.id, fallbackId: options.sessionId, title, cwd: header?.cwd },
          {
            ...(systemPrompt === undefined ? {} : { systemPrompt }),
            ...(tools === undefined ? {} : { tools })
          }
        )
      )
  };
}
