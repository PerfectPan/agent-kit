import { compactUsage, lenient, type Usage } from "@rivus/agent-kit-sessions/spi";
import * as z from "zod/mini";

/** One JSONL row of a session log: an event type, its sequence and time, and its data. */
const DshEnvelope = z.looseObject({
  type: z.string(),
  seq: lenient(z.number()),
  time: lenient(z.number()),
  data: lenient(z.unknown())
});

export interface DshEventValue {
  type: string;
  seq?: number;
  time?: number;
  data?: unknown;
}

export function dshEventOf(value: unknown): DshEventValue | undefined {
  return z.safeParse(DshEnvelope, value).data;
}

const DshHeader = z.looseObject({
  type: z.literal("session"),
  version: lenient(z.number()),
  id: lenient(z.string()),
  createdAt: lenient(z.number()),
  cwd: lenient(z.string()),
  parentSession: lenient(z.string()),
  delegationDepth: lenient(z.number()),
  agentPreset: lenient(z.string())
});

export interface DshHeaderValue {
  type: "session";
  version?: number;
  id?: string;
  createdAt?: number;
  cwd?: string;
  parentSession?: string;
  delegationDepth?: number;
  agentPreset?: string;
}

export function dshHeaderOf(value: unknown): DshHeaderValue | undefined {
  return z.safeParse(DshHeader, value).data;
}

const DshUsage = z.looseObject({
  inputTokens: lenient(z.number()),
  outputTokens: lenient(z.number()),
  totalTokens: lenient(z.number()),
  cacheReadTokens: lenient(z.number()),
  cacheWriteTokens: lenient(z.number()),
  reasoningTokens: lenient(z.number())
});

export interface DshUsageValue {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  reasoningTokens?: number;
}

export function dshUsageOf(value: unknown): Usage | undefined {
  const parsed = z.safeParse(DshUsage, value).data;
  if (!parsed) {
    return undefined;
  }
  return compactUsage({
    ...(parsed.inputTokens === undefined ? {} : { inputTokens: parsed.inputTokens }),
    ...(parsed.outputTokens === undefined ? {} : { outputTokens: parsed.outputTokens }),
    ...(parsed.totalTokens === undefined ? {} : { totalTokens: parsed.totalTokens }),
    ...(parsed.cacheReadTokens === undefined ? {} : { cacheReadTokens: parsed.cacheReadTokens }),
    ...(parsed.cacheWriteTokens === undefined ? {} : { cacheWriteTokens: parsed.cacheWriteTokens }),
    ...(parsed.reasoningTokens === undefined ? {} : { reasoningTokens: parsed.reasoningTokens })
  });
}

export type DshContentPart =
  | { kind: "text"; text: string }
  | { kind: "reasoning"; text: string }
  | { kind: "tool_call"; id: string; name: string; args: string }
  | { kind: "image" }
  | { kind: "unknown"; type: string };

const TextBlock = z.looseObject({ type: z.literal("text"), text: z.string() });
const ReasoningBlock = z.looseObject({ type: z.literal("reasoning"), text: z.string() });
const ToolCallBlock = z.looseObject({
  type: z.literal("tool-call"),
  id: z.string(),
  name: z.string(),
  arguments: z.string()
});
const ImageBlock = z.looseObject({ type: z.literal("image") });
const BlockType = z.looseObject({ type: z.string() });

/** The content blocks of a message, in order. */
export function dshContentParts(content: unknown): DshContentPart[] {
  if (!Array.isArray(content)) {
    return [];
  }
  const out: DshContentPart[] = [];
  for (const raw of content) {
    const text = z.safeParse(TextBlock, raw).data;
    if (text) {
      out.push({ kind: "text", text: text.text });
      continue;
    }
    const reasoning = z.safeParse(ReasoningBlock, raw).data;
    if (reasoning) {
      out.push({ kind: "reasoning", text: reasoning.text });
      continue;
    }
    const tool = z.safeParse(ToolCallBlock, raw).data;
    if (tool) {
      out.push({ kind: "tool_call", id: tool.id, name: tool.name, args: tool.arguments });
      continue;
    }
    if (z.safeParse(ImageBlock, raw).data) {
      out.push({ kind: "image" });
      continue;
    }
    out.push({ kind: "unknown", type: z.safeParse(BlockType, raw).data?.type ?? "unknown" });
  }
  return out;
}

const DshMessage = z.looseObject({
  role: z.string(),
  content: lenient(z.array(z.unknown())),
  source: lenient(
    z.looseObject({ kind: lenient(z.string()), provider: lenient(z.string()), model: lenient(z.string()) })
  ),
  toolCallId: lenient(z.string()),
  isError: lenient(z.boolean()),
  id: lenient(z.string())
});

export interface DshMessageValue {
  role: string;
  content?: readonly unknown[];
  source?: { kind?: string; provider?: string; model?: string };
  toolCallId?: string;
  isError?: boolean;
  id?: string;
}

export function dshMessageOf(value: unknown): DshMessageValue | undefined {
  return z.safeParse(DshMessage, value).data;
}

/** A `user/message` event's `data` is the message itself, not a wrapper. */
export function dshUserMessageOf(value: unknown): DshMessageValue | undefined {
  return z.safeParse(DshMessage, value).data;
}

const DshMessageEnvelope = z.looseObject({ message: lenient(DshMessage) });

/** The message a `system/message`, `developer/message` or `tool/result` wraps in `data.message`. */
export function dshMessageDataOf(value: unknown): DshMessageValue | undefined {
  return z.safeParse(DshMessageEnvelope, value).data?.message;
}

const DshAssistant = z.looseObject({ message: lenient(DshMessage), usage: lenient(DshUsage) });

export interface DshAssistantValue {
  message?: DshMessageValue;
  usage?: DshUsageValue;
}

export function dshAssistantOf(value: unknown): DshAssistantValue | undefined {
  return z.safeParse(DshAssistant, value).data;
}

const DshToolCall = z.looseObject({ callId: z.string(), name: z.string(), arguments: z.string() });

export interface DshToolCallValue {
  callId: string;
  name: string;
  arguments: string;
}

export function dshToolCallOf(value: unknown): DshToolCallValue | undefined {
  return z.safeParse(DshToolCall, value).data;
}

const DshRequestHeader = z.looseObject({
  header: lenient(
    z.looseObject({
      config: lenient(z.looseObject({ provider: lenient(z.string()), model: lenient(z.string()) })),
      tools: lenient(z.array(z.unknown()))
    })
  )
});

export interface DshRequestHeaderValue {
  config?: { provider?: string; model?: string };
  tools?: readonly unknown[];
}

export function dshRequestHeaderOf(value: unknown): DshRequestHeaderValue | undefined {
  return z.safeParse(DshRequestHeader, value).data?.header;
}

const DshCompaction = z.looseObject({
  shadowedSeqs: lenient(z.array(z.number())),
  shadowedTokenCount: lenient(z.number()),
  summary: lenient(z.array(z.unknown()))
});

export interface DshCompactionValue {
  shadowedSeqs?: number[];
  shadowedTokenCount?: number;
  summary?: readonly unknown[];
}

export function dshCompactionOf(value: unknown): DshCompactionValue | undefined {
  return z.safeParse(DshCompaction, value).data;
}

const DshTitle = z.looseObject({ title: lenient(z.string()) });

export function dshTitleOf(value: unknown): string | undefined {
  return z.safeParse(DshTitle, value).data?.title;
}
