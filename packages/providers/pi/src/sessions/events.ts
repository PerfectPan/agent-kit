import { type Result, err, ok } from "@rivus/agent-kit-catalog/spi";
import {
  type Capability,
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
  shadowBefore,
  type UnknownFormatGeneration,
  unknownFormatGeneration
} from "@rivus/agent-kit-sessions/spi";

import { PI_ID } from "../facts.js";
import {
  type PiEntryValue,
  type PiHeaderValue,
  type PiContentPart,
  piContentParts,
  piEntryOf,
  piHeaderOf,
  PI_SESSION_VERSION,
  piUsageOf
} from "../records.js";

/** The record types a read handles as bookkeeping: they become skipped records, never events. */
const BOOKKEEPING = new Set(["session_info", "label", "custom"]);

/** Whether a message content has an image part. */
function hasImage(parts: readonly PiContentPart[]): boolean {
  return parts.some((part) => part.kind === "image");
}

function imageMediaType(parts: readonly PiContentPart[]): string | undefined {
  const image = parts.find((part) => part.kind === "image");
  return image?.kind === "image" ? image.mediaType : undefined;
}

function textOf(parts: readonly PiContentPart[]): string {
  return parts
    .filter((part): part is Extract<PiContentPart, { kind: "text" }> => part.kind === "text")
    .map((part) => part.text)
    .join("\n");
}

function requestOf(entry: PiEntryValue, model: string | undefined): RequestPayload {
  const message = entry.message;
  return {
    granularity: "request",
    ...((message?.model ?? model) ? { model: message?.model ?? model } : {}),
    ...(message?.responseId === undefined ? {} : { responseId: message.responseId }),
    ...(piUsageOf(message?.usage) === undefined ? {} : { usage: piUsageOf(message?.usage) }),
    ...(message?.stopReason === undefined ? {} : { finishReason: message.stopReason })
  };
}

/** Everything a Pi session can record. A transcript lists the subset its own records show. */
export const PI_CAPABILITIES: readonly Capability[] = [
  "requests",
  "usage",
  "reasoning",
  "compaction",
  "compactionTokens"
];

/** What one translated session can show. A session with no usage lists no `usage`, and so on. */
export function piCapabilities(transcript: Pick<ParsedTranscript, "events">): Capability[] {
  const out: Capability[] = [];
  const has = (test: (event: TranscriptEvent) => boolean): boolean => transcript.events.some(test);
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
  return out;
}

export interface PiTranslationOptions {
  /** Keep every event; `false` is the summarize pass, which keeps only what the caller counts. */
  readonly retain: boolean;
  /** The session id from the ref, when the header records none. */
  readonly sessionId?: string;
}

export interface PiTranslation {
  /** Every event, in file order; empty when `retain` is false. */
  readonly events: TranscriptEvent[];
  /** Records that produced no event, with the reason. */
  readonly skipped: { reason: string; record: SourcedRecord }[];
  /** Translates one record; `ts` is the inherited time the events take. */
  step(record: SourcedRecord, ts: number): Result<readonly TranscriptEvent[], UnknownFormatGeneration>;
  /** The finished transcript; call once after the last `step`. */
  finish(): ParsedTranscript;
}

/**
 * One Pi session file into transcript events. The file is a tree: `id`/`parentId` link entries, and the last entry is
 * the current leaf. The adapter reads the file in order, so a branch that was left behind still appears; its records
 * are not on the leaf's path, and a `branch_summary` is the agent's own record of coming back from it. Compaction
 * cuts the context at `firstKeptEntryId`: the events before that entry are shadowed by the compaction event.
 */
export function createPiTranslation(options: PiTranslationOptions): PiTranslation {
  const events: TranscriptEvent[] = [];
  const skipped: { reason: string; record: SourcedRecord }[] = [];
  const lineById = new Map<string, number>();
  const cuts: { event: TranscriptEvent; firstKeptLine: number | undefined }[] = [];
  let header: PiHeaderValue | undefined;
  let model: string | undefined;
  let title: string | undefined;
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

  function emitUser(record: SourcedRecord, ts: number, payload: Record<string, unknown>): TranscriptEvent {
    return emit(baseEvent(record, "user", payload, { ts }));
  }

  function emitMessage(record: SourcedRecord, ts: number, entry: PiEntryValue): void {
    const message = entry.message;
    if (message === undefined) {
      skip(record, "message-without-body");
      return;
    }
    if (message.role === "user") {
      const parts = piContentParts(message.content);
      const text = textOf(parts);
      emitUser(record, ts, {
        ...(text ? { text } : {}),
        ...(hasImage(parts) ? { image: true } : {}),
        ...(imageMediaType(parts) === undefined ? {} : { mediaType: imageMediaType(parts) })
      });
      return;
    }
    if (message.role === "assistant") {
      const parts = piContentParts(message.content);
      const requestId = lineId(record, 0);
      const requestKey = `request:${requestId}`;
      const request = baseEvent(record, "request", requestOf(entry, model), {
        id: requestId,
        ts,
        requestId: requestKey
      });
      emit(request);
      let partIndex = 1;
      for (const part of parts) {
        if (part.kind === "text") {
          emit(
            baseEvent(
              record,
              "assistant",
              { text: part.text },
              { id: lineId(record, partIndex++), ts, requestId: requestKey }
            )
          );
        } else if (part.kind === "thinking") {
          emit(
            baseEvent(record, "reasoning", part.redacted ? { redacted: true } : { text: part.text }, {
              id: lineId(record, partIndex++),
              ts,
              requestId: requestKey
            })
          );
        } else if (part.kind === "tool_call") {
          emit(
            baseEvent(
              record,
              "tool_call",
              { callId: part.id, name: part.name, ...(part.args === undefined ? {} : { args: part.args }) },
              { id: lineId(record, partIndex++), ts, requestId: requestKey }
            )
          );
        } else if (part.kind === "image") {
          emit(
            baseEvent(
              record,
              "assistant",
              { image: true, ...(part.mediaType === undefined ? {} : { mediaType: part.mediaType }) },
              { id: lineId(record, partIndex++), ts, requestId: requestKey }
            )
          );
        } else {
          emit(
            baseEvent(
              record,
              "unknown",
              { type: part.type },
              { id: lineId(record, partIndex++), ts, requestId: requestKey }
            )
          );
        }
      }
      return;
    }
    if (message.role === "toolResult") {
      const parts = piContentParts(message.content);
      const text = textOf(parts);
      emit(
        baseEvent(
          record,
          "tool_result",
          {
            callId: message.toolCallId ?? "",
            ...(text ? { output: text } : {}),
            ...(message.isError === true ? { isError: true } : {})
          },
          { ts }
        )
      );
      return;
    }
    if (message.role === "bashExecution") {
      const callId = entry.id ?? lineId(record, 0);
      const command = message.command ?? "";
      const output = message.output ?? "";
      const exitCode = message.exitCode;
      const isError = message.cancelled === true || (exitCode !== undefined && exitCode !== 0);
      emit(baseEvent(record, "tool_call", { callId, name: "bash", args: { command } }, { id: lineId(record, 0), ts }));
      emit(
        baseEvent(
          record,
          "tool_result",
          { callId, output, ...(exitCode === undefined ? {} : { exitCode }), ...(isError ? { isError: true } : {}) },
          { id: lineId(record, 1), ts }
        )
      );
      return;
    }
    if (message.role === "custom") {
      skip(record, "custom-message");
      return;
    }
    if (message.role === "branchSummary") {
      emitUser(record, ts, { text: message.summary ?? "", injected: true });
      return;
    }
    if (message.role === "compactionSummary") {
      emitUser(record, ts, { text: message.summary ?? "", compactSummary: true });
      return;
    }
    skip(record, `message-role:${message.role}`);
  }

  function emitEntry(
    record: SourcedRecord,
    ts: number,
    entry: PiEntryValue
  ): Result<readonly TranscriptEvent[], UnknownFormatGeneration> {
    switch (entry.type) {
      case "message":
        emitMessage(record, ts, entry);
        return ok([]);
      case "compaction": {
        const compaction = baseEvent(
          record,
          "compaction",
          {
            ...(entry.tokensBefore === undefined ? {} : { preTokens: entry.tokensBefore }),
            ...(entry.summary === undefined ? {} : { summary: entry.summary })
          },
          { ts }
        );
        emit(compaction);
        cuts.push({
          event: compaction,
          firstKeptLine: entry.firstKeptEntryId === undefined ? undefined : lineById.get(entry.firstKeptEntryId)
        });
        return ok([]);
      }
      case "branch_summary":
        emitUser(record, ts, { text: entry.summary ?? "", injected: true, branchSummary: true });
        return ok([]);
      case "model_change":
        model = entry.modelId;
        emit(
          baseEvent(
            record,
            "system",
            {
              type: "model_change",
              ...(entry.provider === undefined ? {} : { provider: entry.provider }),
              ...(entry.modelId === undefined ? {} : { model: entry.modelId })
            },
            { ts }
          )
        );
        return ok([]);
      case "thinking_level_change":
        emit(
          baseEvent(
            record,
            "system",
            {
              type: "thinking_level_change",
              ...(entry.thinkingLevel === undefined ? {} : { thinkingLevel: entry.thinkingLevel })
            },
            { ts }
          )
        );
        return ok([]);
      case "custom_message": {
        const content = piContentParts(entry.content);
        const text = textOf(content);
        emitUser(record, ts, {
          ...(text ? { text } : {}),
          ...(hasImage(content) ? { image: true } : {}),
          injected: true,
          ...(entry.customType === undefined ? {} : { customType: entry.customType })
        });
        return ok([]);
      }
      default:
        if (BOOKKEEPING.has(entry.type)) {
          if (entry.type === "session_info" && entry.name) {
            title = entry.name;
          }
          skip(record, entry.type);
        } else {
          emit(baseEvent(record, "unknown", { type: entry.type }, { ts }));
        }
        return ok([]);
    }
  }

  function step(record: SourcedRecord, ts: number): Result<readonly TranscriptEvent[], UnknownFormatGeneration> {
    const parts: TranscriptEvent[] = [];
    stepParts = parts;
    const headerValue = piHeaderOf(record.value);
    if (headerValue !== undefined) {
      if (headerValue.version !== PI_SESSION_VERSION) {
        return err(unknownFormatGeneration(PI_ID, record));
      }
      if (header === undefined) {
        header = headerValue;
        noteTime(ts);
        skip(record, "session-header");
        first = false;
        return ok(parts);
      }
      skip(record, "session-header");
      return ok(parts);
    }
    if (first) {
      return err(unknownFormatGeneration(PI_ID, record));
    }
    const entry = piEntryOf(record.value);
    if (entry === undefined) {
      return err(unknownFormatGeneration(PI_ID, record));
    }
    noteTime(ts);
    if (options.retain && entry.id !== undefined) {
      lineById.set(entry.id, record.line);
    }
    const result = emitEntry(record, ts, entry);
    if (!result.ok) {
      return result;
    }
    return ok(parts);
  }

  function finish(): ParsedTranscript {
    if (options.retain) {
      for (const cut of cuts) {
        shadowBefore(
          events,
          cut.event,
          (event) => cut.firstKeptLine === undefined || event.source.line >= cut.firstKeptLine
        );
      }
      markOrphanToolResults(events);
      assignSeq(events);
    }
    const session: TranscriptSession = {
      id: header?.id ?? options.sessionId ?? "unknown",
      ...(title === undefined ? {} : { title }),
      ...(header?.cwd === undefined ? {} : { cwd: header.cwd }),
      ...(startedAt === undefined ? {} : { startedAt }),
      ...(endedAt === undefined ? {} : { endedAt })
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
