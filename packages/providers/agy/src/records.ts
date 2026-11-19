import * as z from "zod/mini";
import { compactUsage, lenient, timeOfValue, type Usage } from "@rivus/agent-kit-sessions/spi";

interface AgyToolCallRecord {
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
