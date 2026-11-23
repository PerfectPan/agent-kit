import * as z from "zod/mini";
import { compactUsage, lenient, timeOfValue, type Usage } from "@rivus/agent-kit-sessions/spi";

interface QoderRawUsage {
  readonly input_tokens?: number;
  readonly output_tokens?: number;
  readonly cache_read_input_tokens?: number;
  readonly cache_creation_input_tokens?: number;
  readonly cache_creation?: {
    readonly ephemeral_5m_input_tokens?: number;
    readonly ephemeral_1h_input_tokens?: number;
  };
}

type QoderContentBlock =
  | { readonly type: "text"; readonly text: string }
  | { readonly type: "thinking"; readonly thinking: string }
  | { readonly type: "redacted_thinking" }
  | { readonly type: "tool_use"; readonly id: string; readonly name: string; readonly input?: unknown }
  | {
      readonly type: "tool_result";
      readonly tool_use_id: string;
      readonly content?: unknown;
      readonly is_error?: boolean;
    };

interface QoderMessage {
  readonly id?: string;
  readonly role?: string;
  readonly model?: string;
  readonly stop_reason?: string | null;
  readonly content?: string | readonly QoderContentBlock[];
  readonly usage?: QoderRawUsage;
}

/**
 * A `compact_boundary` record's `compactMetadata`: why the compaction ran, the token counts around it, and the
 * messages a partial compaction kept in the context.
 */
interface QoderCompactMetadata {
  readonly trigger?: string;
  readonly preTokens?: number;
  readonly postTokens?: number;
  /** Present only when the compaction kept messages: the uuids of the kept run's first and last records. */
  readonly preservedSegment?: { readonly headUuid?: string; readonly tailUuid?: string };
}

/** An `attachment` record's payload. A `hook_*` attachment is one hook's outcome for the model or the transcript. */
export interface QoderAttachment {
  readonly type?: string;
  readonly hookName?: string;
  readonly hookEvent?: string;
  /** `hook_output` attachments name the event they ran for this way instead of `hookEvent`. */
  readonly hookEventName?: string;
  readonly exitCode?: number;
  readonly durationMs?: number;
}

export interface QoderRecord {
  readonly type: string;
  readonly uuid?: string;
  readonly parentUuid?: string | null;
  readonly sessionId?: string;
  readonly timestamp?: string | number;
  readonly cwd?: string;
  readonly gitBranch?: string;
  readonly version?: string;
  readonly requestId?: string;
  readonly agentId?: string;
  readonly isSidechain?: boolean;
  readonly isMeta?: boolean;
  readonly isCompactSummary?: boolean;
  readonly subtype?: string;
  readonly content?: string;
  readonly durationMs?: number;
  readonly message?: QoderMessage;
  readonly compactMetadata?: QoderCompactMetadata;
  readonly attachment?: QoderAttachment;
}

const CacheCreation = z.looseObject({
  ephemeral_5m_input_tokens: lenient(z.optional(z.number())),
  ephemeral_1h_input_tokens: lenient(z.optional(z.number()))
});

const RawUsage = z.looseObject({
  input_tokens: lenient(z.optional(z.number())),
  output_tokens: lenient(z.optional(z.number())),
  cache_read_input_tokens: lenient(z.optional(z.number())),
  cache_creation_input_tokens: lenient(z.optional(z.number())),
  cache_creation: lenient(z.optional(CacheCreation))
});

const TextBlock = z.looseObject({ type: z.literal("text"), text: z.string() });
const ThinkingBlock = z.looseObject({ type: z.literal("thinking"), thinking: z.string() });
const RedactedThinkingBlock = z.looseObject({ type: z.literal("redacted_thinking") });
const ToolUseBlock = z.looseObject({
  type: z.literal("tool_use"),
  id: z.string(),
  name: z.string(),
  input: lenient(z.unknown())
});
const ToolResultBlock = z.looseObject({
  type: z.literal("tool_result"),
  tool_use_id: z.string(),
  content: lenient(z.unknown()),
  is_error: lenient(z.optional(z.boolean()))
});

const RawMessage = z.looseObject({
  id: lenient(z.optional(z.string())),
  role: lenient(z.optional(z.string())),
  model: lenient(z.optional(z.string())),
  stop_reason: lenient(z.optional(z.nullable(z.string()))),
  content: lenient(z.optional(z.union([z.string(), z.array(z.unknown())]))),
  usage: lenient(z.optional(RawUsage))
});

const PreservedSegment = z.looseObject({
  headUuid: lenient(z.optional(z.string())),
  tailUuid: lenient(z.optional(z.string()))
});

const CompactMetadata = z.looseObject({
  trigger: lenient(z.optional(z.string())),
  preTokens: lenient(z.optional(z.number().check(z.nonnegative()))),
  postTokens: lenient(z.optional(z.number().check(z.nonnegative()))),
  preservedSegment: lenient(z.optional(PreservedSegment))
});

const Attachment = z.looseObject({
  type: lenient(z.optional(z.string())),
  hookName: lenient(z.optional(z.string())),
  hookEvent: lenient(z.optional(z.string())),
  hookEventName: lenient(z.optional(z.string())),
  exitCode: lenient(z.optional(z.number())),
  durationMs: lenient(z.optional(z.number().check(z.nonnegative())))
});

const RawRecord = z.looseObject({
  type: z.string(),
  uuid: lenient(z.optional(z.string())),
  parentUuid: lenient(z.optional(z.nullable(z.string()))),
  sessionId: lenient(z.optional(z.string())),
  timestamp: lenient(z.optional(z.union([z.string(), z.number()]))),
  cwd: lenient(z.optional(z.string())),
  gitBranch: lenient(z.optional(z.string())),
  version: lenient(z.optional(z.string())),
  requestId: lenient(z.optional(z.string())),
  agentId: lenient(z.optional(z.string())),
  isSidechain: lenient(z.optional(z.boolean())),
  isMeta: lenient(z.optional(z.boolean())),
  isCompactSummary: lenient(z.optional(z.boolean())),
  subtype: lenient(z.optional(z.string())),
  content: lenient(z.optional(z.string())),
  durationMs: lenient(z.optional(z.number())),
  message: lenient(z.optional(RawMessage)),
  compactMetadata: lenient(z.optional(CompactMetadata)),
  attachment: lenient(z.optional(Attachment))
});

function parseBlock(item: unknown): QoderContentBlock | undefined {
  return (
    z.safeParse(TextBlock, item).data ??
    z.safeParse(ThinkingBlock, item).data ??
    z.safeParse(RedactedThinkingBlock, item).data ??
    z.safeParse(ToolUseBlock, item).data ??
    z.safeParse(ToolResultBlock, item).data
  );
}

export function qoderRecordOf(value: unknown): QoderRecord | undefined {
  const parsed = z.safeParse(RawRecord, value).data;
  if (parsed === undefined) {
    return undefined;
  }
  const { message: rawMessage, ...rest } = parsed;
  if (rawMessage === undefined) {
    return rest;
  }
  const { content: rawContent, ...msgRest } = rawMessage;
  if (!Array.isArray(rawContent)) {
    return {
      ...rest,
      message: rawContent === undefined ? msgRest : { ...msgRest, content: rawContent }
    };
  }
  const blocks: QoderContentBlock[] = [];
  for (const item of rawContent) {
    const block = parseBlock(item);
    if (block !== undefined) {
      blocks.push(block);
    }
  }
  return { ...rest, message: { ...msgRest, content: blocks } };
}

export function qoderRecordTime(record: QoderRecord): number | undefined {
  return record.timestamp === undefined ? undefined : timeOfValue(record.timestamp);
}

/**
 * Qoder CLI follows Anthropic/Claude Code usage accounting: `input_tokens` excludes `cache_read_input_tokens` and
 * `cache_creation_input_tokens`. Both cache counts are added into `inputTokens` for the kit's total-input convention,
 * while absent counts stay `undefined`.
 */
export function qoderUsageOf(raw: QoderRawUsage | undefined): Usage | undefined {
  if (raw === undefined) {
    return undefined;
  }
  const cache5m = raw.cache_creation?.ephemeral_5m_input_tokens;
  const cache1h = raw.cache_creation?.ephemeral_1h_input_tokens;
  const cacheWrite =
    cache5m !== undefined || cache1h !== undefined ? (cache5m ?? 0) + (cache1h ?? 0) : raw.cache_creation_input_tokens;
  const inputTokens =
    raw.input_tokens === undefined
      ? undefined
      : raw.input_tokens + (raw.cache_read_input_tokens ?? 0) + (cacheWrite ?? 0);
  return compactUsage({
    ...(inputTokens !== undefined ? { inputTokens } : {}),
    ...(raw.output_tokens !== undefined ? { outputTokens: raw.output_tokens } : {}),
    ...(raw.cache_read_input_tokens !== undefined ? { cacheReadTokens: raw.cache_read_input_tokens } : {}),
    ...(cacheWrite !== undefined ? { cacheWriteTokens: cacheWrite } : {}),
    ...(cache1h !== undefined ? { cacheWrite1hTokens: cache1h } : {})
  });
}

export function qoderUsageSize(usage: Usage | undefined): number {
  if (usage === undefined) {
    return -1;
  }
  return usage.totalTokens ?? (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0);
}

export function qoderUserText(message: QoderMessage | undefined): string | undefined {
  if (message?.content === undefined) {
    return undefined;
  }
  if (typeof message.content === "string") {
    return message.content === "" ? undefined : message.content;
  }
  const texts: string[] = [];
  for (const block of message.content) {
    if (block.type === "text" && block.text !== "") {
      texts.push(block.text);
    }
  }
  return texts.length > 0 ? texts.join("\n") : undefined;
}
