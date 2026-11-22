import * as z from "zod/mini";
import { compactUsage, lenient, type Usage } from "@rivus/agent-kit-sessions/spi";

// The `wire.jsonl` event stream of a Kimi Code session, captured on 2.6.0 against a scripted model: a metadata
// header names the protocol version, `turn.prompt` frames turns, `context.append_message` records the messages
// the model saw, `context.append_loop_event` the per-step model loop (content parts, tool calls and results,
// step ends with usage), and `turn.ended` closes it. The schemas stay module-private; the value types are
// declared by hand, like the other adapters', and the `*Of` functions return them.

/** One part of a message's content: `text` parts carry `text`, `think` parts the model's reasoning in `think`. */
export interface KimiContentPartValue {
  type: string;
  text?: string;
  think?: string;
  [field: string]: unknown;
}

const contentPart = z.looseObject({
  type: z.string(),
  text: lenient(z.optional(z.string())),
  think: lenient(z.optional(z.string()))
});

interface KimiOriginValue {
  kind: string;
  variant?: string;
  event?: string;
  blocked?: boolean;
  [field: string]: unknown;
}

const messageOrigin = z.looseObject({
  kind: z.string(),
  variant: lenient(z.optional(z.string())),
  event: lenient(z.optional(z.string())),
  blocked: lenient(z.optional(z.boolean()))
});

const KimiHeader = z.object({ type: z.literal("metadata"), protocol_version: z.string() });

/** The wire's first line: `{ type: "metadata", protocol_version }`. */
export function kimiHeaderOf(value: unknown): { protocol_version: string } | undefined {
  const parsed = z.safeParse(KimiHeader, value).data;
  return parsed === undefined ? undefined : { protocol_version: parsed.protocol_version };
}

export interface KimiUsageValue {
  inputOther?: number;
  output?: number;
  inputCacheRead?: number;
  inputCacheCreation?: number;
  [field: string]: unknown;
}

const KimiUsage = z.looseObject({
  inputOther: lenient(z.number()),
  output: lenient(z.number()),
  inputCacheRead: lenient(z.optional(z.number())),
  inputCacheCreation: lenient(z.optional(z.number()))
});

/** The usage of a step end or usage record; `undefined` for anything else. */
export function kimiUsageOfRecord(value: unknown): KimiUsageValue | undefined {
  return z.safeParse(KimiUsage, value).data;
}

export interface KimiTurnPromptValue {
  promptId: string;
  turnId?: string | number;
  input: KimiContentPartValue[];
  origin?: KimiOriginValue;
  [field: string]: unknown;
}

const KimiTurnPrompt = z.looseObject({
  type: z.literal("turn.prompt"),
  promptId: z.string(),
  turnId: lenient(z.union([z.string(), z.number()])),
  input: z.array(contentPart),
  origin: lenient(z.optional(messageOrigin))
});

/** A `turn.prompt` record; `undefined` for anything else. */
export function kimiTurnPromptOf(value: unknown): KimiTurnPromptValue | undefined {
  return z.safeParse(KimiTurnPrompt, value).data;
}

export interface KimiLoopEventValue {
  type: string;
  uuid?: string;
  turnId?: string | number;
  step?: number;
  stepUuid?: string;
  block?: number;
  part?: KimiContentPartValue;
  toolCallId?: string;
  name?: string;
  args?: unknown;
  parentUuid?: string;
  result?: { output?: unknown; isError?: boolean; [field: string]: unknown };
  finishReason?: string;
  usage?: KimiUsageValue;
  messageId?: string;
  [field: string]: unknown;
}

const KimiLoopEvent = z.looseObject({
  type: z.string(),
  uuid: lenient(z.optional(z.string())),
  turnId: lenient(z.optional(z.union([z.string(), z.number()]))),
  step: lenient(z.optional(z.number())),
  stepUuid: lenient(z.optional(z.string())),
  block: lenient(z.optional(z.number())),
  part: lenient(z.optional(contentPart)),
  toolCallId: lenient(z.optional(z.string())),
  name: lenient(z.optional(z.string())),
  args: lenient(z.optional(z.any())),
  parentUuid: lenient(z.optional(z.string())),
  result: lenient(
    z.optional(z.looseObject({ output: lenient(z.optional(z.any())), isError: lenient(z.optional(z.boolean())) }))
  ),
  finishReason: lenient(z.optional(z.string())),
  usage: lenient(z.optional(KimiUsage)),
  messageId: lenient(z.optional(z.string()))
});

/** A `context.append_loop_event` record's inner event; `undefined` for anything else. */
export function kimiLoopEventOf(value: unknown): KimiLoopEventValue | undefined {
  return z.safeParse(KimiLoopEvent, value).data;
}

export interface KimiTurnEndedValue {
  durationMs?: number;
  reason?: string;
  [field: string]: unknown;
}

const KimiTurnEnded = z.looseObject({
  type: z.literal("turn.ended"),
  durationMs: lenient(z.optional(z.number())),
  reason: lenient(z.optional(z.string()))
});

/** A `turn.ended` record; `undefined` for anything else. */
export function kimiTurnEndedOf(value: unknown): KimiTurnEndedValue | undefined {
  return z.safeParse(KimiTurnEnded, value).data;
}

export interface KimiProfileBindValue {
  systemPrompt?: string;
  modelAlias?: string;
  [field: string]: unknown;
}

const KimiProfileBind = z.looseObject({
  type: z.literal("profile.bind"),
  systemPrompt: lenient(z.optional(z.string())),
  modelAlias: lenient(z.optional(z.string()))
});

/** A `profile.bind` record; `undefined` for anything else. */
export function kimiProfileBindOf(value: unknown): KimiProfileBindValue | undefined {
  return z.safeParse(KimiProfileBind, value).data;
}

interface KimiMessageValue {
  role: string;
  content: KimiContentPartValue[];
  id?: string;
  origin?: KimiOriginValue;
  [field: string]: unknown;
}

const KimiMessage = z.looseObject({
  role: z.string(),
  content: z.array(contentPart),
  id: lenient(z.optional(z.string())),
  origin: lenient(z.optional(messageOrigin))
});

export interface KimiAppendMessageValue {
  message?: KimiMessageValue;
  [field: string]: unknown;
}

const KimiAppendMessage = z.looseObject({
  type: z.literal("context.append_message"),
  message: lenient(z.optional(KimiMessage))
});

/** A `context.append_message` record; `undefined` for anything else. */
export function kimiAppendMessageOf(value: unknown): KimiAppendMessageValue | undefined {
  return z.safeParse(KimiAppendMessage, value).data;
}

/** A compaction's `summary`: plain text, or the summary message itself whose text parts carry it. */
type KimiCompactionSummaryValue = string | { role: string; content: KimiContentPartValue[] } | undefined;

export interface KimiApplyCompactionValue {
  agentId?: string;
  tokensBefore?: number;
  tokensAfter?: number;
  summary?: KimiCompactionSummaryValue;
  contextSummary?: string;
  wireLines?: { start: number; end: number };
  [field: string]: unknown;
}

const compactionSummary = lenient(
  z.optional(z.union([z.string(), z.looseObject({ role: z.string(), content: z.array(contentPart) })]))
);

const KimiApplyCompaction = z.looseObject({
  type: z.literal("context.apply_compaction"),
  agentId: lenient(z.optional(z.string())),
  tokensBefore: lenient(z.optional(z.number().check(z.nonnegative()))),
  tokensAfter: lenient(z.optional(z.number().check(z.nonnegative()))),
  summary: compactionSummary,
  contextSummary: lenient(z.optional(z.string())),
  wireLines: lenient(z.optional(z.looseObject({ start: z.number(), end: z.number() })))
});

/** A `context.apply_compaction` record; `undefined` for anything else. */
export function kimiApplyCompactionOf(value: unknown): KimiApplyCompactionValue | undefined {
  return z.safeParse(KimiApplyCompaction, value).data;
}

/** The message content's text parts, joined; an empty array reads as no text. */
export function kimiContentText(content: readonly KimiContentPartValue[]): string | undefined {
  const text = content
    .filter((part) => part.type === "text" && typeof part.text === "string")
    .map((part) => part.text)
    .join("");
  return text === "" ? undefined : text;
}

/** The compaction's summary text: the string variants directly, the message variant as its text parts. */
export function kimiCompactionSummaryText(
  summary: KimiCompactionSummaryValue,
  contextSummary: string | undefined
): string | undefined {
  if (typeof summary === "string") {
    return summary === "" ? undefined : summary;
  }
  if (typeof summary === "object") {
    const text = kimiContentText(summary.content);
    if (text !== undefined) {
      return text;
    }
  }
  return contextSummary !== undefined && contextSummary !== "" ? contextSummary : undefined;
}

export interface KimiSubagentSpawnedValue {
  subagentId: string;
  subagentName: string;
  parentToolCallId: string;
  runInBackground?: boolean;
  description?: string;
  [field: string]: unknown;
}

const KimiSubagentSpawned = z.looseObject({
  type: z.literal("subagent.spawned"),
  subagentId: z.string(),
  subagentName: z.string(),
  parentToolCallId: z.string(),
  runInBackground: lenient(z.optional(z.boolean())),
  description: lenient(z.optional(z.string()))
});

/** A `subagent.spawned` record; `undefined` for anything else. */
export function kimiSubagentSpawnedOf(value: unknown): KimiSubagentSpawnedValue | undefined {
  return z.safeParse(KimiSubagentSpawned, value).data;
}

/** The kit's usage convention: `inputTokens` includes cache reads and writes; `undefined` without both counts. */
export function kimiUsageOf(usage: KimiUsageValue): Usage | undefined {
  if (usage.inputOther === undefined || usage.output === undefined) {
    return undefined;
  }
  return compactUsage({
    inputTokens: usage.inputOther + (usage.inputCacheRead ?? 0) + (usage.inputCacheCreation ?? 0),
    outputTokens: usage.output,
    ...(usage.inputCacheRead !== undefined ? { cacheReadTokens: usage.inputCacheRead } : {}),
    ...(usage.inputCacheCreation !== undefined ? { cacheWriteTokens: usage.inputCacheCreation } : {})
  });
}
