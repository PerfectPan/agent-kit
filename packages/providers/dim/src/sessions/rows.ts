import { definedFields } from "@rivus/agent-kit-catalog/spi";
import { SESSION_TITLE_MAX, lenient, type SessionHead } from "@rivus/agent-kit-sessions/spi";
import * as z from "zod/mini";
import { DIM_ID } from "../facts.js";

// The rows of the v2 database as the load and the summarize passes both read them: one schema per table, written
// against the columns and the JSON DimCode 0.5.27 writes. A column of another type reads as absent, and a row its
// schema rejects yields no event in either pass, so the two passes agree on which rows count.

const Rowid = z.union([z.number(), z.bigint()]);

/** A JSON column's value; `undefined` when the column is absent or not JSON. */
function jsonOf(text: string | undefined): unknown {
  if (text === undefined) {
    return undefined;
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

/** An ISO column as epoch milliseconds; 0 when the column is absent or not a date, so the event inherits a time. */
export function dimTime(value: unknown): number {
  const parsed = typeof value === "string" ? Date.parse(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : 0;
}

const DimSessionRow = z.looseObject({
  sessionId: z.string(),
  cwd: lenient(z.string()),
  title: lenient(z.optional(z.string())),
  status: lenient(z.string()),
  createdAt: lenient(z.string()),
  updatedAt: lenient(z.string()),
  latestMessageUpdatedAt: lenient(z.optional(z.string())),
  latestMessageCreatedAt: lenient(z.optional(z.string())),
  latestLedgerCreatedAt: lenient(z.optional(z.string()))
});

/** A `sessions` row; the columns beside the id are present as far as the query selected them. */
export interface DimSessionRowValue {
  readonly sessionId: string;
  readonly cwd: string;
  readonly title?: string;
  readonly status?: string;
  readonly createdAt?: string;
  readonly updatedAt?: string;
  readonly latestMessageUpdatedAt?: string;
  readonly latestMessageCreatedAt?: string;
  readonly latestLedgerCreatedAt?: string;
}

/** The `sessions` row as the adapter reads it; `undefined` for a row without a session id. */
export function dimSessionRowOf(value: unknown): DimSessionRowValue | undefined {
  const row = z.safeParse(DimSessionRow, value).data;
  return row === undefined
    ? undefined
    : definedFields({
        sessionId: row.sessionId,
        cwd: row.cwd ?? "",
        title: row.title,
        status: row.status,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
        latestMessageUpdatedAt: row.latestMessageUpdatedAt,
        latestMessageCreatedAt: row.latestMessageCreatedAt,
        latestLedgerCreatedAt: row.latestLedgerCreatedAt
      });
}

/** The head a `sessions` row lists: title, working directory, start time and latest activity across its tables. */
export function dimHeadOf(path: string, row: DimSessionRowValue, sizeBytes: number, mtimeMs: number): SessionHead {
  const startedAt = dimTime(row.createdAt);
  const lastAt = Math.max(
    dimTime(row.updatedAt),
    dimTime(row.latestMessageUpdatedAt),
    dimTime(row.latestMessageCreatedAt),
    dimTime(row.latestLedgerCreatedAt)
  );
  return definedFields({
    ref: { agent: DIM_ID, path, sessionId: row.sessionId },
    lastActiveAt: lastAt > 0 ? lastAt : mtimeMs,
    sizeBytes,
    title: row.title !== undefined && row.title !== "" ? row.title.slice(0, SESSION_TITLE_MAX) : undefined,
    cwd: row.cwd !== "" ? row.cwd : undefined,
    startedAt: startedAt > 0 ? startedAt : undefined
  });
}

const DimPartEnvelope = z.looseObject({
  type: z.string(),
  startTime: lenient(z.optional(z.string())),
  endTime: lenient(z.optional(z.string()))
});
const DimTextPart = z.looseObject({ text: lenient(z.optional(z.string())) });
const DimThinkingPart = z.looseObject({ thinking: lenient(z.optional(z.string())) });
const DimToolUsePart = z.looseObject({ id: z.string(), name: z.string(), input: z.optional(z.unknown()) });
const DimToolResultPart = z.looseObject({
  tool_use_id: z.string(),
  content: z.optional(z.unknown()),
  is_error: lenient(z.optional(z.boolean()))
});

/**
 * One part of a message's `parts` array: the shapes DimCode writes that become events — `text`; the assistant's
 * `thinking`; the assistant's `tool_use` with the call id the `tool_result` part names back — or `other` with the
 * reason it becomes no event, such as a file part or a shape the columns do not complete.
 */
export type DimPartValue =
  | { readonly type: "text"; readonly text: string; readonly startTime?: string; readonly endTime?: string }
  | { readonly type: "thinking"; readonly thinking: string; readonly startTime?: string; readonly endTime?: string }
  | {
      readonly type: "tool_use";
      readonly id: string;
      readonly name: string;
      readonly input?: unknown;
      readonly startTime?: string;
    }
  | { readonly type: "tool_result"; readonly toolUseId: string; readonly content?: unknown; readonly isError: boolean }
  | { readonly type: "other"; readonly reason: string };

function dimPartOf(value: unknown): DimPartValue {
  const envelope = z.safeParse(DimPartEnvelope, value).data;
  if (envelope === undefined) {
    return { type: "other", reason: "part:unreadable" };
  }
  const timing = definedFields({ startTime: envelope.startTime, endTime: envelope.endTime });
  const invalid = { type: "other" as const, reason: `part:${envelope.type}:invalid` };
  switch (envelope.type) {
    case "text": {
      const part = z.safeParse(DimTextPart, value).data;
      return part?.text === undefined ? invalid : { type: "text", text: part.text, ...timing };
    }
    case "thinking": {
      const part = z.safeParse(DimThinkingPart, value).data;
      return part?.thinking === undefined ? invalid : { type: "thinking", thinking: part.thinking, ...timing };
    }
    case "tool_use": {
      const part = z.safeParse(DimToolUsePart, value).data;
      return part === undefined
        ? invalid
        : { type: "tool_use", ...definedFields({ id: part.id, name: part.name, input: part.input }), ...timing };
    }
    case "tool_result": {
      const part = z.safeParse(DimToolResultPart, value).data;
      return part === undefined
        ? invalid
        : {
            type: "tool_result",
            ...definedFields({ toolUseId: part.tool_use_id, content: part.content }),
            isError: part.is_error === true
          };
    }
    default:
      return { type: "other", reason: `part:${envelope.type}` };
  }
}

/** A message as its events read it: the recognized parts of its `parts` JSON in order, and the parsed JSON itself. */
export interface DimMessageValue {
  readonly messageId: string;
  readonly role: string;
  readonly parts: readonly DimPartValue[];
  /** The row's parsed `parts` column, which the row's events share as their original record. */
  readonly rawParts: unknown;
  /** The run the row's `metadata` column groups the message under. */
  readonly runId?: string;
  readonly createdAt: number;
}

/** A `messages` row: its rowid, and the message when the row and its `parts` JSON parse. */
export interface DimMessageRow {
  readonly rowid: number;
  readonly value: DimMessageValue | undefined;
}

const DimMessageRowSchema = z.looseObject({
  messageId: z.string(),
  role: lenient(z.string()),
  parts: lenient(z.string()),
  metadata: lenient(z.optional(z.string())),
  createdAt: lenient(z.string())
});
const DimMessageMetadata = z.looseObject({ runId: lenient(z.optional(z.string())) });
const DimPartList = z.array(z.unknown());

/** The `messages` row as the adapter reads it; `undefined` only for a row without a rowid. */
export function dimMessageRowOf(value: unknown): DimMessageRow | undefined {
  const rowid = z.safeParse(Rowid, (value as { rowid?: unknown } | null)?.rowid).data;
  const row = z.safeParse(DimMessageRowSchema, value).data;
  if (rowid === undefined) {
    return undefined;
  }
  const rawParts = z.safeParse(DimPartList, jsonOf(row?.parts)).data;
  let message: DimMessageValue | undefined;
  if (row !== undefined && rawParts !== undefined) {
    message = definedFields({
      messageId: row.messageId,
      role: row.role ?? "",
      parts: rawParts.map(dimPartOf),
      rawParts,
      runId: z.safeParse(DimMessageMetadata, jsonOf(row.metadata)).data?.runId,
      createdAt: dimTime(row.createdAt)
    });
  }
  return { rowid: Number(rowid), value: message };
}

const DimCheckpoint = z.looseObject({
  messageId: z.string(),
  createdAt: lenient(z.string()),
  reason: lenient(z.optional(z.enum(["auto", "manual"]))),
  summarySnapshot: lenient(z.optional(z.string())),
  diagnostics: lenient(
    z.optional(
      z.looseObject({
        estimatedInputTokens: lenient(z.optional(z.number())),
        estimatedPostCompactionTokens: lenient(z.optional(z.number()))
      })
    )
  )
});

/**
 * One compaction DimCode applied to a session, as `compaction_states.checkpoints` records it: the context up to and
 * including the message `cursorMessageId` names was replaced by the summary.
 */
export interface DimCheckpointValue {
  readonly cursorMessageId: string;
  readonly createdAt: number;
  readonly trigger?: "auto" | "manual";
  /** DimCode's own token estimate of the context before and after the compaction, when it recorded one. */
  readonly preTokens?: number;
  readonly postTokens?: number;
  readonly summary?: string;
}

function tokens(value: number | undefined): number | undefined {
  return value !== undefined && Number.isFinite(value) && value >= 0 ? value : undefined;
}

/** The `checkpoints` column of a `compaction_states` row: one entry per applied compaction, oldest first. */
function dimCheckpointsOf(value: unknown): DimCheckpointValue[] {
  const entries = z.safeParse(DimPartList, value).data ?? [];
  const checkpoints: DimCheckpointValue[] = [];
  for (const entry of entries) {
    const parsed = z.safeParse(DimCheckpoint, entry).data;
    if (parsed === undefined) {
      continue;
    }
    checkpoints.push(
      definedFields({
        cursorMessageId: parsed.messageId,
        createdAt: dimTime(parsed.createdAt),
        trigger: parsed.reason,
        preTokens: tokens(parsed.diagnostics?.estimatedInputTokens),
        postTokens: tokens(parsed.diagnostics?.estimatedPostCompactionTokens),
        summary: parsed.summarySnapshot === "" ? undefined : parsed.summarySnapshot
      })
    );
  }
  return checkpoints;
}

const DimCheckpointRow = z.looseObject({ checkpoints: lenient(z.string()) });

/** A `compaction_states` row: the parsed `checkpoints` column and the JSON its checkpoints' events share as their original. */
export interface DimCheckpointRowValue {
  readonly rowid: number;
  readonly checkpoints: readonly DimCheckpointValue[];
  readonly raw: unknown;
}

/** The `compaction_states` row as the adapter reads it; `undefined` without a rowid or a `checkpoints` JSON array. */
export function dimCheckpointRowOf(value: unknown): DimCheckpointRowValue | undefined {
  const rowid = z.safeParse(Rowid, (value as { rowid?: unknown } | null)?.rowid).data;
  const raw = z.safeParse(DimPartList, jsonOf(z.safeParse(DimCheckpointRow, value).data?.checkpoints)).data;
  if (rowid === undefined || raw === undefined) {
    return undefined;
  }
  return { rowid: Number(rowid), checkpoints: dimCheckpointsOf(raw), raw };
}

const DimRelationRow = z.looseObject({
  sourceSessionId: z.string(),
  targetSessionId: z.string(),
  typeData: lenient(z.optional(z.string())),
  createdAt: lenient(z.string())
});
const DimSubagentTypeData = z.looseObject({
  parentToolCallId: lenient(z.optional(z.string())),
  subagentType: lenient(z.optional(z.string())),
  forkContext: lenient(z.optional(z.string()))
});

/** A `session_relations` row of type `subagent`: the source session spawned the target from one of its tool calls. */
export interface DimRelationValue {
  readonly sourceSessionId: string;
  readonly targetSessionId: string;
  readonly createdAt: number;
  /** The id of the `tool_use` part of the parent's message that started the subagent. */
  readonly toolCallId?: string;
  readonly subagentType?: string;
  readonly forkContext?: string;
}

/** A `subagent` relation row as the adapter reads it; `undefined` for a row without both session ids. */
export function dimRelationOf(value: unknown): DimRelationValue | undefined {
  const row = z.safeParse(DimRelationRow, value).data;
  if (row === undefined) {
    return undefined;
  }
  const typeData = z.safeParse(DimSubagentTypeData, jsonOf(row.typeData)).data;
  return definedFields({
    sourceSessionId: row.sourceSessionId,
    targetSessionId: row.targetSessionId,
    createdAt: dimTime(row.createdAt),
    toolCallId: typeData?.parentToolCallId,
    subagentType: typeData?.subagentType,
    forkContext: typeData?.forkContext
  });
}
