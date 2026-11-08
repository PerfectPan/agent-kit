import { type Result, err, ok } from "@rivus/agent-kit-catalog/spi";
import {
  type Capability,
  type MessagePayload,
  type ParsedTranscript,
  type RequestPayload,
  type SourcedRecord,
  type TranscriptEvent,
  type TranscriptSession,
  assignSeq,
  baseEvent,
  lineId,
  MAIN_LANE_ID,
  markOrphanToolResults,
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
  dshTitleOf,
  dshUsageOf,
  dshUserMessageOf
} from "../records.js";

/** Everything a DeepSeek Harness session can record. A transcript lists the subset its own log shows. */
export const DSH_CAPABILITIES: readonly Capability[] = [
  "requests",
  "usage",
  "reasoning",
  "compaction",
  "compactionTokens",
  "systemPrompt",
  "toolSchemas"
];

/** What one translated session can show, from the events and session fields it produced. */
export function dshCapabilities(parsed: ParsedTranscript): Capability[] {
  const out: Capability[] = [];
  const has = (test: (event: TranscriptEvent) => boolean): boolean => parsed.events.some(test);
  if (has((event) => event.kind === "request")) {
    out.push("requests");
  }
  if (has((event) => event.kind === "request" && event.payload.usage !== undefined)) {
    out.push("usage");
  }
  if (has((event) => event.kind === "reasoning")) {
    out.push("reasoning");
  }
  if (has((event) => event.kind === "compaction")) {
    out.push("compaction");
  }
  if (
    has(
      (event) =>
        event.kind === "compaction" && (event.payload.preTokens !== undefined || event.payload.postTokens !== undefined)
    )
  ) {
    out.push("compactionTokens");
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
  "step/start",
  "step/end",
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

export interface DshTranslation {
  readonly events: TranscriptEvent[];
  readonly skipped: { reason: string; record: SourcedRecord }[];
  step(record: SourcedRecord, ts: number): Result<readonly TranscriptEvent[], UnknownFormatGeneration>;
  finish(): ParsedTranscript;
}

function textOf(parts: readonly { kind: string; text?: string }[]): string {
  return parts
    .filter((part): part is { kind: "text"; text: string } => part.kind === "text" && part.text !== undefined)
    .map((part) => part.text)
    .join("\n");
}

function hasImage(parts: readonly { kind: string }[]): boolean {
  return parts.some((part) => part.kind === "image");
}

/** A user message's payload: human prompts stay prompts, injected context and compaction checkpoints are flagged. */
function userPayload(message: DshMessageValue): MessagePayload {
  const parts = dshContentParts(message.content);
  const text = textOf(parts);
  const source = message.source?.kind;
  return {
    ...(text ? { text } : {}),
    ...(hasImage(parts) ? { image: true } : {}),
    ...(source === undefined || source === "user" ? {} : { injected: true }),
    ...(source === "compact-checkpoint" ? { compactSummary: true, injected: false } : {})
  };
}

/** One harness session log into transcript events. */
export function createDshTranslation(options: DshTranslationOptions): DshTranslation {
  const events: TranscriptEvent[] = [];
  const skipped: { reason: string; record: SourcedRecord }[] = [];
  const seqLines = new Map<number, number>();
  let header: ReturnType<typeof dshHeaderOf>;
  let title: string | undefined;
  let systemPrompt: string | undefined;
  let tools: readonly unknown[] | undefined;
  let model: string | undefined;
  let startedAt: number | undefined;
  let endedAt: number | undefined;
  let first = true;
  let stepParts: TranscriptEvent[] | undefined;

  function noteTime(ts: number): void {
    startedAt = startedAt === undefined ? ts : Math.min(startedAt, ts);
    endedAt = endedAt === undefined ? ts : Math.max(endedAt, ts);
  }

  function emit(event: TranscriptEvent): TranscriptEvent {
    if (options.retain) {
      events.push(event);
    }
    stepParts?.push(event);
    return event;
  }

  function skip(record: SourcedRecord, reason: string): void {
    if (options.retain) {
      skipped.push({ reason, record });
    }
  }

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
    for (const event of events) {
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
    const requestId = lineId(record, 0);
    const requestKey = `request:${requestId}`;
    const request: RequestPayload = {
      granularity: "request",
      ...(message?.source?.model === undefined && model === undefined
        ? {}
        : { model: message?.source?.model ?? model }),
      ...(message?.id === undefined ? {} : { responseId: message.id }),
      ...(usage === undefined ? {} : { usage })
    };
    emit(baseEvent(record, "request", request, { id: requestId, ts, requestId: requestKey }));
    const parts = dshContentParts(message?.content);
    let index = 1;
    for (const part of parts) {
      if (part.kind === "text") {
        emit(
          baseEvent(
            record,
            "assistant",
            { text: part.text },
            { id: lineId(record, index++), ts, requestId: requestKey }
          )
        );
      } else if (part.kind === "reasoning") {
        emit(
          baseEvent(
            record,
            "reasoning",
            { text: part.text },
            { id: lineId(record, index++), ts, requestId: requestKey }
          )
        );
      } else if (part.kind === "tool_call") {
        emit(
          baseEvent(
            record,
            "tool_call",
            { callId: part.id, name: part.name, args: part.args },
            { id: lineId(record, index++), ts, requestId: requestKey }
          )
        );
      } else if (part.kind === "image") {
        emit(
          baseEvent(record, "assistant", { image: true }, { id: lineId(record, index++), ts, requestId: requestKey })
        );
      } else {
        emit(
          baseEvent(record, "unknown", { type: part.type }, { id: lineId(record, index++), ts, requestId: requestKey })
        );
      }
    }
  }

  function step(record: SourcedRecord, ts: number): Result<readonly TranscriptEvent[], UnknownFormatGeneration> {
    const parts: TranscriptEvent[] = [];
    stepParts = parts;
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
        noteTime(headerValue.createdAt ?? ts);
        skip(record, "session-header");
        first = false;
        return ok(parts);
      }
      skip(record, "session-header");
      return ok(parts);
    }
    if (first) {
      return err(unknownFormatGeneration(DSH_ID, record));
    }
    if (event.seq !== undefined) {
      seqLines.set(event.seq, record.line);
    }
    noteTime(event.time ?? ts);
    switch (event.type) {
      case "user/message": {
        const message = dshUserMessageOf(event.data);
        if (message === undefined) {
          skip(record, "user-message-without-body");
          break;
        }
        emit(baseEvent(record, "user", userPayload(message), { ts }));
        break;
      }
      case "assistant/message":
        emitAssistant(record, ts, event.data);
        break;
      case "tool/result": {
        const message = dshMessageDataOf(event.data);
        if (message === undefined) {
          skip(record, "tool-result-without-body");
          break;
        }
        const content = textOf(dshContentParts(message.content));
        emit(
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
        const text = message === undefined ? "" : textOf(dshContentParts(message.content));
        if (text) {
          systemPrompt = text;
        }
        emit(baseEvent(record, "system", { type: "system", ...(text ? { text } : {}) }, { ts }));
        break;
      }
      case "developer/message": {
        const message = dshMessageDataOf(event.data);
        const text = message === undefined ? "" : textOf(dshContentParts(message.content));
        emit(baseEvent(record, "system", { type: "developer", ...(text ? { text } : {}), injected: true }, { ts }));
        break;
      }
      case "request/header": {
        const parsed = dshRequestHeaderOf(event.data);
        model = parsed?.config?.model;
        if (parsed?.tools !== undefined) {
          tools = parsed.tools;
        }
        emit(
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
        const compaction = dshCompactionOf(event.data);
        const eventValue = baseEvent(
          record,
          "compaction",
          {
            ...(compaction?.shadowedTokenCount === undefined ? {} : { preTokens: compaction.shadowedTokenCount }),
            ...(compaction?.summary === undefined ? {} : { summary: compaction.summary })
          },
          { ts }
        );
        emit(eventValue);
        shadow(compaction?.shadowedSeqs, eventValue);
        break;
      }
      case "compaction/summary": {
        const compaction = dshCompactionOf(event.data);
        const eventValue = baseEvent(
          record,
          "compaction",
          {
            ...(compaction?.shadowedTokenCount === undefined ? {} : { preTokens: compaction.shadowedTokenCount }),
            ...(compaction?.summary === undefined ? {} : { summary: compaction.summary })
          },
          { ts }
        );
        emit(eventValue);
        shadow(compaction?.shadowedSeqs, eventValue);
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
          emit(baseEvent(record, "request", request, { id, ts, requestId: `request:${id}` }));
        }
        break;
      }
      case "session/title": {
        title = dshTitleOf(event.data);
        skip(record, "session-title");
        break;
      }
      default:
        if (BOOKKEEPING.has(event.type)) {
          skip(record, event.type);
        } else {
          // A type outside the bookkeeping set is content the harness recorded that this reader does not
          // understand: like pi, codex and claude-code, it becomes an `unknown` event instead of vanishing, so a
          // future harness event type stays visible in transcripts.
          emit(baseEvent(record, "unknown", { type: event.type }, { ts }));
        }
        break;
    }
    return ok(parts);
  }

  function finish(): ParsedTranscript {
    if (options.retain) {
      markOrphanToolResults(events);
      assignSeq(events);
    }
    const session: TranscriptSession = {
      id: header?.id ?? options.sessionId ?? "unknown",
      ...(title === undefined ? {} : { title }),
      ...(header?.cwd === undefined ? {} : { cwd: header.cwd }),
      ...(startedAt === undefined ? {} : { startedAt }),
      ...(endedAt === undefined ? {} : { endedAt }),
      ...(systemPrompt === undefined ? {} : { systemPrompt }),
      ...(tools === undefined ? {} : { tools })
    };
    return {
      events,
      skipped: skipped.map(({ reason, record }) => ({ reason, source: record })),
      session,
      agents: [{ id: MAIN_LANE_ID }]
    };
  }

  return { events, skipped, step, finish };
}
