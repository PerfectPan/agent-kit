import * as z from "zod/mini";

import { lenient, logTimestamp } from "@rivus/agent-kit-sessions/spi";

/**
 * One chat record of a `.jsonl` chat. A chat's first line is its header: `{ sessionId, projectHash, startTime,
 * lastUpdated, kind }` with no `id` and no `type`. The lines after are the CLI's chat items: `{ id, type, content,
 * timestamp }`, with `model` and `tokens` on `gemini` items, `toolCalls` on a `gemini` item that calls tools, and
 * `thought` on a `thinking` item. `$set` and `$patch` markers amend the chat's stored fields and an item's content.
 */
export interface GeminiCliChatRecordValue {
  /** The item's id; absent on the chat's header line and on `$set` markers. */
  id?: string;
  /** The item's type: `user`, `gemini`, `thinking`, `tool_group`, `compression`, `info`, `error`, `warning`, …. */
  type?: string;
  /** The item's text: a `user` prompt, a `gemini` reply, or a notice's message. */
  content?: string;
  model?: string;
  timestamp?: number | string;
  /** The chat header's session id, and every record's copy of it. */
  sessionId?: string;
  kind?: string;
}

/** One tool call of a `gemini` record's `toolCalls`: the CLI appends the record again whenever a call changes state. */
export interface GeminiCliToolCallValue {
  id?: string;
  name?: string;
  status?: string;
  args?: unknown;
  resultDisplay?: unknown;
}

const GeminiCliChatRecord = z.looseObject({
  id: lenient(z.string()),
  type: lenient(z.string()),
  content: lenient(z.string()),
  model: lenient(z.string()),
  sessionId: lenient(z.string()),
  kind: lenient(z.string()),
  timestamp: logTimestamp
});

/** The statuses that end a tool call. A call still `executing` (or awaiting confirmation) has no result yet. */
export function isGeminiCliToolDone(status: string | undefined): boolean {
  return status === "success" || status === "error" || status === "canceled";
}

/** Whether a tool call ended in error; a canceled call was refused, not failed. */
export function isGeminiCliToolError(status: string | undefined): boolean {
  return status === "error";
}

/** A record's value as a chat record, or `undefined` when the line is not one (a `$set`/`$patch` marker, for one). */
export function geminiCliChatRecord(value: unknown): GeminiCliChatRecordValue | undefined {
  const parsed = z.safeParse(GeminiCliChatRecord, value).data;
  if (parsed === undefined) {
    return undefined;
  }
  return {
    ...(parsed.id === undefined ? {} : { id: parsed.id }),
    ...(parsed.type === undefined ? {} : { type: parsed.type }),
    ...(parsed.content === undefined ? {} : { content: parsed.content }),
    ...(parsed.model === undefined ? {} : { model: parsed.model }),
    ...(parsed.sessionId === undefined ? {} : { sessionId: parsed.sessionId }),
    ...(parsed.kind === undefined ? {} : { kind: parsed.kind }),
    ...(parsed.timestamp === undefined ? {} : { timestamp: parsed.timestamp })
  };
}

/** The records of one chat file's lines, with `undefined` for lines that are not chat records. */
export function geminiCliChatRecords(records: readonly { value: unknown }[]): (GeminiCliChatRecordValue | undefined)[] {
  return records.map((record) => geminiCliChatRecord(record.value));
}

/** Reads one raw tool call of a `gemini` record's `toolCalls`; `undefined` when the entry is not one. */
export function geminiCliToolCallOf(raw: unknown): GeminiCliToolCallValue | undefined {
  if (typeof raw !== "object" || raw === null) {
    return undefined;
  }
  const record = raw as Record<string, unknown>;
  if (record.id === undefined && record.name === undefined) {
    return undefined;
  }
  return {
    id: record.id as string | undefined,
    name: record.name as string | undefined,
    status: record.status as string | undefined,
    args: record.args,
    resultDisplay: record.resultDisplay
  };
}
