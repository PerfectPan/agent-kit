import * as z from "zod/mini";
import { compactUsage, lenient, timeOfValue, type Usage } from "@rivus/agent-kit-sessions/spi";

export interface AgyToolCallRecord {
  readonly name: string;
  readonly args?: unknown;
}

export interface AgyStepRecord {
  readonly step_index?: number;
  readonly source?: string;
  readonly type: string;
  readonly status?: string;
  readonly created_at?: string;
  readonly content?: string;
  readonly thinking?: string;
  readonly model?: string;
  readonly input_tokens?: number;
  readonly cache_read_tokens?: number;
  readonly output_tokens?: number;
  readonly tool_calls?: readonly AgyToolCallRecord[];
  readonly error?: string;
}

const AgyToolCall = z.looseObject({
  name: z.string(),
  args: lenient(z.unknown())
});

const AgyStep = z.looseObject({
  step_index: lenient(z.optional(z.number())),
  source: lenient(z.optional(z.string())),
  type: z.string(),
  status: lenient(z.optional(z.string())),
  created_at: lenient(z.optional(z.string())),
  content: lenient(z.optional(z.string())),
  thinking: lenient(z.optional(z.string())),
  model: lenient(z.optional(z.string())),
  input_tokens: lenient(z.optional(z.number())),
  cache_read_tokens: lenient(z.optional(z.number())),
  output_tokens: lenient(z.optional(z.number())),
  tool_calls: lenient(z.optional(z.array(z.unknown()))),
  error: lenient(z.optional(z.string()))
});

export function agyStepOf(value: unknown): AgyStepRecord | undefined {
  const parsed = z.safeParse(AgyStep, value).data;
  if (parsed === undefined) {
    return undefined;
  }
  const { tool_calls: rawToolCalls, ...rest } = parsed;
  if (rawToolCalls === undefined) {
    return rest;
  }
  const toolCalls: AgyToolCallRecord[] = [];
  for (const item of rawToolCalls) {
    const call = z.safeParse(AgyToolCall, item).data;
    if (call !== undefined) {
      toolCalls.push(call);
    }
  }
  return { ...rest, tool_calls: toolCalls };
}

export function agyRecordTime(step: AgyStepRecord): number | undefined {
  return step.created_at === undefined ? undefined : timeOfValue(step.created_at);
}

// A conversation id names a directory under `brain/`, so it is one path segment and never a dot or a separator.
const AgyConversationId = z.string().check(z.regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/));

const AgySubagentSpawned = z.looseObject({ conversationId: AgyConversationId });

const AgySubagentCall = z.looseObject({ Role: lenient(z.optional(z.string())) });

const SUBAGENT_CREATED = "Created the following subagent:";

/** The index of the `}` closing the `{` at `start`, past the strings and nested objects between them. */
function closingBrace(text: string, start: number): number {
  let depth = 0;
  let quoted = false;
  for (let at = start; at < text.length; at += 1) {
    const char = text.at(at);
    if (quoted) {
      if (char === "\\") {
        at += 1;
      } else if (char === '"') {
        quoted = false;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === "{") {
      depth += 1;
    } else if (char === "}" && (depth -= 1) === 0) {
      return at;
    }
  }
  return -1;
}

/**
 * The conversation an `invoke_subagent` tool result created. The result text names it as a JSON object after
 * `Created the following subagent:`, in free-form text before and after, so the object is cut out by its braces and
 * parsed; `undefined` when the text is not that shape or names no conversation id.
 */
export function agySubagentSpawnedOf(content: string): string | undefined {
  const marker = content.indexOf(SUBAGENT_CREATED);
  const start = marker < 0 ? -1 : content.indexOf("{", marker + SUBAGENT_CREATED.length);
  const end = start < 0 ? -1 : closingBrace(content, start);
  if (end < 0) {
    return undefined;
  }
  let value: unknown;
  try {
    value = JSON.parse(content.slice(start, end + 1));
  } catch {
    return undefined;
  }
  return z.safeParse(AgySubagentSpawned, value).data?.conversationId;
}

/** The `Role` of an `invoke_subagent` call's arguments: the label the parent gave the subagent. */
export function agySubagentRoleOf(args: unknown): string | undefined {
  return z.safeParse(AgySubagentCall, args).data?.Role;
}

const RELAYED_MESSAGE_SENDER = /\[Message\] timestamp=\S+ sender=(\S+)/;

/**
 * The conversation whose message a `SYSTEM_MESSAGE` relays. Antigravity CLI delivers the messages conversations
 * send each other as a system message wrapping `[Message] timestamp=<time> sender=<conversation-id> priority=…
 * content=…`; a subagent conversation's first record is the message that spawned it.
 */
export function agyRelayedMessageSender(content: string): string | undefined {
  return RELAYED_MESSAGE_SENDER.exec(content)?.[1];
}

/**
 * Antigravity CLI records `input_tokens` excluding `cache_read_tokens` (observed on live transcripts where
 * `cache_read_tokens` exceeds `input_tokens`). The kit's `Usage` convention makes `inputTokens` total input tokens,
 * so `cache_read_tokens` is added into `inputTokens` here while absent counts stay `undefined`.
 */
export function agyUsageOf(step: AgyStepRecord): Usage | undefined {
  const hasInput = step.input_tokens !== undefined || step.cache_read_tokens !== undefined;
  return compactUsage({
    ...(hasInput ? { inputTokens: (step.input_tokens ?? 0) + (step.cache_read_tokens ?? 0) } : {}),
    ...(step.output_tokens !== undefined ? { outputTokens: step.output_tokens } : {}),
    ...(step.cache_read_tokens !== undefined ? { cacheReadTokens: step.cache_read_tokens } : {})
  });
}
