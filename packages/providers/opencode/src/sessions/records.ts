import { type SqliteSessionMessage, type Usage, compactUsage, lenient } from "@rivus/agent-kit-sessions/spi";
import * as z from "zod/mini";

const Tokens = z.looseObject({
  input: lenient(z.number()),
  output: lenient(z.number()),
  reasoning: lenient(z.number()),
  total: lenient(z.number()),
  cache: lenient(z.looseObject({ read: lenient(z.number()), write: lenient(z.number()) }))
});

/** OpenCode counts the cache beside `input`; the kit counts cache reads and writes inside `inputTokens`. */
function opencodeUsageOf(tokens: z.infer<typeof Tokens> | undefined): Usage | undefined {
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

/** A stored message's JSON as the shared SQLite session reader reads it, with OpenCode's token counting. */
export function opencodeMessageOf(value: unknown): SqliteSessionMessage | undefined {
  const message = z.safeParse(MessageData, value).data;
  if (message === undefined) {
    return undefined;
  }
  return {
    role: message.role,
    model: message.modelID,
    finish: message.finish,
    created: message.time?.created,
    usage: opencodeUsageOf(message.tokens)
  };
}
