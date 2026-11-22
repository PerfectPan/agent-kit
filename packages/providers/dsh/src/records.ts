import { compactUsage, lenient, parseSavedUsage, type Usage } from "@rivus/agent-kit-sessions/spi";
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
  agentPreset: lenient(z.string()),
  isSeeded: lenient(z.boolean())
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
  isSeeded?: boolean;
}

export function dshHeaderOf(value: unknown): DshHeaderValue | undefined {
  return z.safeParse(DshHeader, value).data;
}

/**
 * The fields every dsh session generation's header carries. Detection reads them without pinning a generation, so
 * an old-generation file still lists at discovery and fails `load` with `UnknownFormatGeneration`; a schema bound to
 * one generation would hide it from detection.
 */
const DshSessionHeaderShape = z.looseObject({
  type: z.literal("session"),
  version: z.number(),
  createdAt: z.number()
});

/** Whether `value` is a dsh session header of some generation: the shape `detect` accepts. */
export function isDshSessionHeader(value: unknown): boolean {
  return z.safeParse(DshSessionHeaderShape, value).data !== undefined;
}

/**
 * The `usage` of a model call, in agent-kit's `Usage` convention. DeepSeek Harness counts `inputTokens` without the
 * cache: its DeepSeek adapter stores the wire `input_tokens` as is and derives `totalTokens` as input + output +
 * cacheRead + cacheWrite, and the Pi adapter maps `usage.input` the same way. `Usage.inputTokens` includes cache
 * reads and writes, so they are added back; `totalTokens` keeps the logged value.
 */
export function dshUsageOf(value: unknown): Usage | undefined {
  const parsed = parseSavedUsage(value);
  if (!parsed) {
    return undefined;
  }
  const input = parsed.inputTokens;
  return compactUsage({
    inputTokens:
      input === undefined ? undefined : input + (parsed.cacheReadTokens ?? 0) + (parsed.cacheWriteTokens ?? 0),
    outputTokens: parsed.outputTokens,
    totalTokens: parsed.totalTokens,
    cacheReadTokens: parsed.cacheReadTokens,
    cacheWriteTokens: parsed.cacheWriteTokens,
    reasoningTokens: parsed.reasoningTokens
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

/** A `user/message` event's `data` is the message itself, not a wrapper. */
export function dshUserMessageOf(value: unknown): DshMessageValue | undefined {
  return z.safeParse(DshMessage, value).data;
}

const DshMessageEnvelope = z.looseObject({ message: lenient(DshMessage) });

/** The message a `system/message`, `developer/message` or `tool/result` wraps in `data.message`. */
export function dshMessageDataOf(value: unknown): DshMessageValue | undefined {
  return z.safeParse(DshMessageEnvelope, value).data?.message;
}

const DshAssistant = z.looseObject({
  turn: lenient(z.number()),
  step: lenient(z.number()),
  message: lenient(DshMessage),
  usage: lenient(z.unknown()),
  stream: lenient(z.array(z.unknown()))
});

export interface DshAssistantValue {
  turn?: number;
  step?: number;
  message?: DshMessageValue;
  usage?: unknown;
  stream?: readonly unknown[];
}

export function dshAssistantOf(value: unknown): DshAssistantValue | undefined {
  return z.safeParse(DshAssistant, value).data;
}

const DshStepBoundary = z.looseObject({
  turn: lenient(z.number()),
  step: lenient(z.number())
});

export interface DshStepBoundaryValue {
  turn?: number;
  step?: number;
}

export function dshStepBoundaryOf(value: unknown): DshStepBoundaryValue | undefined {
  return z.safeParse(DshStepBoundary, value).data;
}

const DshStreamChunk = z.looseObject({ time: z.number() });
const DshStreamBatched = z.looseObject({ time0: z.number(), dt: z.array(z.number()) });

export interface DshStreamTimeRange {
  first: number;
  last: number;
}

/**
 * The first and last recorded timestamps across an `assistant/message.stream` array. Chunk records carry an epoch
 * millisecond `time`; batched chunk records carry `time0` plus a `dt[]` array of signed finite deltas. Records with
 * missing or malformed timestamps/deltas are skipped; returns `undefined` when no valid timed record is present.
 */
export function dshStreamTimeRange(stream: readonly unknown[] | undefined): DshStreamTimeRange | undefined {
  if (stream === undefined || stream.length === 0) {
    return undefined;
  }
  let first: number | undefined;
  let last: number | undefined;
  for (const item of stream) {
    const chunk = z.safeParse(DshStreamChunk, item).data;
    if (chunk !== undefined && Number.isFinite(chunk.time)) {
      if (first === undefined) {
        first = chunk.time;
      }
      last = chunk.time;
      continue;
    }
    const batched = z.safeParse(DshStreamBatched, item).data;
    if (batched !== undefined && Number.isFinite(batched.time0)) {
      let delta = 0;
      let valid = true;
      for (const d of batched.dt) {
        if (!Number.isFinite(d)) {
          valid = false;
          break;
        }
        delta += d;
      }
      if (!valid) {
        continue;
      }
      const end = batched.time0 + delta;
      if (!Number.isFinite(end)) {
        continue;
      }
      if (first === undefined) {
        first = batched.time0;
      }
      last = end;
    }
  }
  if (first === undefined || last === undefined) {
    return undefined;
  }
  return { first, last };
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
  summary: lenient(z.array(z.unknown())),
  // The compaction plugin's summarization call (`purpose: "compaction"`) never goes through the agent loop, so the
  // call's provider, model and usage land on the `compaction/summary` event itself.
  provider: lenient(z.string()),
  model: lenient(z.string()),
  usage: lenient(z.unknown())
});

export interface DshCompactionValue {
  shadowedSeqs?: number[];
  shadowedTokenCount?: number;
  summary?: readonly unknown[];
  provider?: string;
  model?: string;
  usage?: unknown;
}

export function dshCompactionOf(value: unknown): DshCompactionValue | undefined {
  return z.safeParse(DshCompaction, value).data;
}

const DshTitle = z.looseObject({ title: lenient(z.string()) });

export function dshTitleOf(value: unknown): string | undefined {
  return z.safeParse(DshTitle, value).data?.title;
}
