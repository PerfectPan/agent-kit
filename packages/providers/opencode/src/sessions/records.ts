import { compactUsage, lenient, type Usage } from "@rivus/agent-kit-sessions/spi";
import * as z from "zod/mini";

const Tokens = z.looseObject({
  input: lenient(z.number()),
  output: lenient(z.number()),
  reasoning: lenient(z.number()),
  total: lenient(z.number()),
  cache: lenient(z.looseObject({ read: lenient(z.number()), write: lenient(z.number()) }))
});

export interface OpenCodeTokensValue {
  input?: number;
  output?: number;
  reasoning?: number;
  total?: number;
  cache?: { read?: number; write?: number };
}

/** OpenCode counts the cache beside `input`; the kit counts cache reads and writes inside `inputTokens`. */
export function opencodeUsageOf(tokens: OpenCodeTokensValue | undefined): Usage | undefined {
  if (!tokens) {
    return undefined;
  }
  const read = tokens.cache?.read ?? 0;
  const write = tokens.cache?.write ?? 0;
  const hasInput = tokens.input !== undefined || read > 0 || write > 0;
  return compactUsage({
    ...(hasInput ? { inputTokens: (tokens.input ?? 0) + read + write } : {}),
    ...(tokens.output === undefined ? {} : { outputTokens: tokens.output + (tokens.reasoning ?? 0) }),
    ...(tokens.reasoning === undefined ? {} : { reasoningTokens: tokens.reasoning }),
    ...(tokens.cache?.read === undefined ? {} : { cacheReadTokens: tokens.cache.read }),
    ...(tokens.cache?.write === undefined ? {} : { cacheWriteTokens: tokens.cache.write }),
    ...(tokens.total === undefined ? {} : { totalTokens: tokens.total })
  });
}

const MessageData = z.looseObject({
  role: z.string(),
  tokens: lenient(Tokens),
  modelID: lenient(z.string()),
  providerID: lenient(z.string()),
  finish: lenient(z.string()),
  time: lenient(z.looseObject({ created: lenient(z.number()), completed: lenient(z.number()) }))
});

export interface OpenCodeMessageValue {
  role: string;
  tokens?: OpenCodeTokensValue;
  modelID?: string;
  providerID?: string;
  finish?: string;
  time?: { created?: number; completed?: number };
}

export function opencodeMessageOf(value: unknown): OpenCodeMessageValue | undefined {
  return z.safeParse(MessageData, value).data;
}

const ToolState = z.looseObject({
  status: lenient(z.string()),
  input: lenient(z.unknown()),
  output: lenient(z.unknown()),
  error: lenient(z.unknown()),
  time: lenient(z.looseObject({ start: lenient(z.number()), end: lenient(z.number()) }))
});

export interface OpenCodeToolState {
  status?: string;
  input?: unknown;
  output?: unknown;
  error?: unknown;
  time?: { start?: number; end?: number };
}

const PartData = z.looseObject({
  type: z.string(),
  text: lenient(z.string()),
  tool: lenient(z.string()),
  callID: lenient(z.string()),
  state: lenient(ToolState),
  time: lenient(z.looseObject({ start: lenient(z.number()), end: lenient(z.number()) }))
});

export interface OpenCodePartValue {
  type: string;
  text?: string;
  tool?: string;
  callID?: string;
  state?: OpenCodeToolState;
  time?: { start?: number; end?: number };
}

export function opencodePartOf(value: unknown): OpenCodePartValue | undefined {
  return z.safeParse(PartData, value).data;
}
