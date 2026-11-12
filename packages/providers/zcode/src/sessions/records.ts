import { type SqliteSessionMessage, lenient } from "@rivus/agent-kit-sessions/spi";
import * as z from "zod/mini";

import { zcodeTokensOf, zcodeUsage } from "../usage.js";

/**
 * A stored `message` row's parsed `data`. The model and provider arrive under the AI SDK spellings `modelId` and
 * `providerId` on current rows; older rows carry the OpenCode spellings `modelID` and `providerID`, so a reader
 * accepts both and prefers the current one.
 */
const ZcodeMessageData = z.looseObject({
  role: z.string(),
  modelId: lenient(z.string()),
  modelID: lenient(z.string()),
  providerId: lenient(z.string()),
  providerID: lenient(z.string()),
  finish: lenient(z.string()),
  time: lenient(z.looseObject({ created: lenient(z.number()), completed: lenient(z.number()) })),
  tokens: lenient(z.unknown())
});

/** A stored message's JSON as the shared SQLite session reader reads it; ZCode's tokens already count the kit's way. */
export function zcodeMessageOf(value: unknown): SqliteSessionMessage | undefined {
  const message = z.safeParse(ZcodeMessageData, value).data;
  if (message === undefined) {
    return undefined;
  }
  return {
    role: message.role,
    model: message.modelId ?? message.modelID,
    finish: message.finish,
    created: message.time?.created,
    usage: zcodeUsage(zcodeTokensOf(message.tokens))
  };
}
