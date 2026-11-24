import { definedFields } from "@rivus/agent-kit-catalog/spi";
import {
  baseEvent,
  finalizeTranscriptEvents,
  shadowBefore,
  skipRecord,
  sqliteSource,
  type CompactionPayload,
  type RequestPayload,
  type SkippedRecord,
  type SourcedRecord,
  type TranscriptEvent,
  type TranscriptEventBody,
  type Usage
} from "@rivus/agent-kit-sessions/spi";
import { dimLedgerUsage, type DimLedgerRowValue } from "../records.js";
import {
  dimTime,
  type DimCheckpointValue,
  type DimMessageRow,
  type DimMessageValue,
  type DimPartValue
} from "./rows.js";
import { dimTakeRunDuration, type DimLaneRows } from "./store.js";

// The rows of one lane — a session's messages, its ledger and its compaction checkpoints — as transcript events, and
// the per-row rule the summarize pass counts by without building the events.

/** What one part of a message row becomes: the event body with its time, or the reason it becomes no event. */
export type DimPartStep = { readonly ts: number; readonly body: TranscriptEventBody } | { readonly skip: string };

function dimPartStep(message: DimMessageValue, part: DimPartValue): DimPartStep {
  if (part.type === "other") {
    return { skip: part.reason };
  }
  // A part takes its own start time; a part without one, such as a tool result, takes its message's.
  const startedAt = "startTime" in part ? dimTime(part.startTime) : 0;
  const ts = startedAt > 0 ? startedAt : message.createdAt;
  const assistant = message.role === "assistant";
  switch (part.type) {
    case "text": {
      return message.role === "user" || assistant
        ? { ts, body: { kind: message.role, payload: definedFields({ text: part.text, runId: message.runId }) } }
        : { skip: `message-role:${message.role}` };
    }
    case "thinking": {
      return assistant
        ? { ts, body: { kind: "reasoning", payload: definedFields({ text: part.thinking, runId: message.runId }) } }
        : { skip: "part:thinking" };
    }
    case "tool_use": {
      return assistant
        ? {
            ts,
            body: { kind: "tool_call", payload: definedFields({ callId: part.id, name: part.name, args: part.input }) }
          }
        : { skip: "part:tool_use" };
    }
    case "tool_result": {
      return message.role === "tool_result"
        ? {
            ts,
            body: {
              kind: "tool_result",
              payload: definedFields({
                callId: part.toolUseId,
                output: part.content,
                isError: part.isError ? true : undefined
              })
            }
          }
        : { skip: "part:tool_result" };
    }
  }
}

/** What each part of a message row becomes, in the row's order; the load and the summarize pass read a row by this one rule. */
export function dimPartSteps(message: DimMessageValue): DimPartStep[] {
  return message.parts.map((part) => dimPartStep(message, part));
}

/** The `compaction` payload of one checkpoint: the trigger and the token estimates DimCode recorded with it. */
function dimCompactionPayload(checkpoint: DimCheckpointValue): CompactionPayload {
  return definedFields({
    trigger: checkpoint.trigger,
    preTokens: checkpoint.preTokens,
    postTokens: checkpoint.postTokens,
    summary: checkpoint.summary
  });
}

/** The `request` payload of one ledger row: a settled usage event of the run, which stays as the response id. */
function dimRequestPayload(row: DimLedgerRowValue, usage: Usage, durationMs: number | undefined): RequestPayload {
  return definedFields({
    granularity: "turn" as const,
    requestId: row.ledgerId,
    responseId: row.runId,
    model: row.modelId,
    provider: row.providerId,
    usage,
    durationMs,
    costUsd: row.cost ?? undefined
  });
}

/**
 * The message index each checkpoint's event follows: the message its cursor names, else the last message created no
 * later than the checkpoint, else none (-1): a checkpoint without a time and a cursor follows the last message.
 */
function dimCompactionAnchor(checkpoint: DimCheckpointValue, messages: readonly DimMessageRow[]): number {
  const cursor = messages.findIndex((message) => message.value?.messageId === checkpoint.cursorMessageId);
  if (cursor !== -1) {
    return cursor;
  }
  let at = -1;
  for (const [index, message] of messages.entries()) {
    if (message.value !== undefined && (checkpoint.createdAt <= 0 || message.value.createdAt <= checkpoint.createdAt)) {
      at = index;
    }
  }
  return at;
}

/** One lane's events: the records that became none, and the `tool_call` event of each call id its assistant messages record. */
export interface DimLaneEvents {
  readonly events: TranscriptEvent[];
  readonly skipped: SkippedRecord[];
  readonly calls: ReadonlyMap<string, TranscriptEvent>;
}

/** The parsed `usage` column of a ledger row, the original its request event keeps; not JSON reads as `undefined`. */
function dimLedgerJson(value: string | undefined): unknown {
  if (value === undefined) {
    return undefined;
  }
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return undefined;
  }
}

/**
 * One lane's rows into events: the parts of each message in `orderKey` order, each compaction after the message its
 * cursor names — the events before it are shadowed, since the summary replaced them in the model's context — then
 * one request per ledger row, at the end, where no compaction shadows them. The lane's events are finalized on their
 * own: times are inherited, orphan tool results flagged and `seq` assigned per lane.
 */
export function translateDimLane(dbPath: string, rows: DimLaneRows, agentId?: string): DimLaneEvents {
  const events: TranscriptEvent[] = [];
  const skipped: SkippedRecord[] = [];
  const calls = new Map<string, TranscriptEvent>();
  const checkpoints = rows.checkpoints;
  const afterMessage = new Map<number, number[]>();
  for (const [index, checkpoint] of (checkpoints?.checkpoints ?? []).entries()) {
    const anchor = dimCompactionAnchor(checkpoint, rows.messages);
    const indexes = afterMessage.get(anchor);
    if (indexes === undefined) {
      afterMessage.set(anchor, [index]);
    } else {
      indexes.push(index);
    }
  }
  const messageRecord = (rowid: number, rawParts: unknown): SourcedRecord => ({
    ...sqliteSource(dbPath, "messages", "parts", rowid, rowid),
    value: rawParts
  });
  const emitCompactions = (after: number): void => {
    for (const index of afterMessage.get(after) ?? []) {
      const checkpoint = checkpoints?.checkpoints[index];
      if (checkpoints === undefined || checkpoint === undefined) {
        continue;
      }
      events.push(
        baseEvent(
          {
            ...sqliteSource(dbPath, "compaction_states", "checkpoints", checkpoints.rowid, checkpoints.rowid),
            value: checkpoints.raw
          },
          "compaction",
          dimCompactionPayload(checkpoint),
          definedFields({ id: `compaction:${checkpoints.rowid}:${index}`, ts: checkpoint.createdAt, agentId })
        )
      );
    }
  };

  emitCompactions(-1);
  for (const [index, message] of rows.messages.entries()) {
    if (message.value === undefined) {
      skipRecord(skipped, messageRecord(message.rowid, undefined), "message-unreadable");
    } else {
      const record = messageRecord(message.rowid, message.value.rawParts);
      // The source names the message's real database row and the event id carries the part's index, so the parts of
      // one message never share an identity, and the rowids of one database never collide across lanes.
      for (const [part, step] of dimPartSteps(message.value).entries()) {
        if ("skip" in step) {
          skipRecord(skipped, record, step.skip);
          continue;
        }
        const event = baseEvent(
          record,
          step.body.kind,
          step.body.payload,
          definedFields({ id: `${message.rowid}:${part}`, ts: step.ts, agentId })
        );
        events.push(event);
        if (event.kind === "tool_call") {
          calls.set(event.payload.callId, event);
        }
      }
    }
    emitCompactions(index);
  }
  // The store records each run's usage in the append-only ledger; the transcript shows one request per row, so the
  // transcript and the usage decoder agree on the same totals. Run durations live once per run in `usage_run_stats`,
  // so attach each run's duration to its first settled ledger row to avoid double-counting.
  const consumedRuns = new Set<string>();
  for (const row of rows.ledger) {
    const source = sqliteSource(dbPath, "usage_ledger", "usage", row.rowid, row.rowid);
    const record: SourcedRecord = { ...source, value: dimLedgerJson(row.usage) };
    const usage = dimLedgerUsage(row.usage);
    if (usage === undefined) {
      skipRecord(skipped, record, "ledger-usage");
      continue;
    }
    events.push(
      baseEvent(
        record,
        "request",
        dimRequestPayload(row, usage, dimTakeRunDuration(row.runId, rows.runDurations, consumedRuns)),
        definedFields({ id: `request:${row.rowid}`, ts: dimTime(row.createdAt), agentId })
      )
    );
  }
  for (const event of events) {
    if (event.kind === "compaction") {
      shadowBefore(events, event);
    }
  }
  finalizeTranscriptEvents(events);
  return { events, skipped, calls };
}
