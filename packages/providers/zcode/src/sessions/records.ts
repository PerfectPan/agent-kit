import { lenient } from "@rivus/agent-kit-sessions/spi";
import * as z from "zod/mini";

import { type ZcodeTokensValue, zcodeTokensOf } from "../usage.js";

export type { ZcodeTokensValue };

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
  time: lenient(z.looseObject({ created: lenient(z.number()), completed: lenient(z.number()) }))
});

export interface ZcodeMessageValue {
  role: string;
  modelId?: string;
  modelID?: string;
  providerId?: string;
  providerID?: string;
  finish?: string;
  time?: { created?: number; completed?: number };
  tokens?: ZcodeTokensValue;
}

export function zcodeMessageOf(value: unknown): ZcodeMessageValue | undefined {
  const message = z.safeParse(ZcodeMessageData, value).data;
  if (message === undefined) {
    return undefined;
  }
  const tokens = zcodeTokensOf((value as Record<string, unknown> | undefined)?.tokens);
  return { ...message, ...(tokens === undefined ? {} : { tokens }) };
}

const ToolState = z.looseObject({
  status: lenient(z.string()),
  input: lenient(z.unknown()),
  output: lenient(z.unknown()),
  error: lenient(z.unknown()),
  time: lenient(z.looseObject({ start: lenient(z.number()), end: lenient(z.number()) }))
});

/** A stored `part` row's parsed `data`; the fields a transcript reads. */
const ZcodePartData = z.looseObject({
  type: z.string(),
  text: lenient(z.string()),
  tool: lenient(z.string()),
  callID: lenient(z.string()),
  state: lenient(ToolState),
  time: lenient(z.looseObject({ start: lenient(z.number()), end: lenient(z.number()) }))
});

export interface ZcodePartValue {
  type: string;
  text?: string;
  tool?: string;
  callID?: string;
  state?: {
    status?: string;
    input?: unknown;
    output?: unknown;
    error?: unknown;
    time?: { start?: number; end?: number };
  };
  time?: { start?: number; end?: number };
}

export function zcodePartOf(value: unknown): ZcodePartValue | undefined {
  return z.safeParse(ZcodePartData, value).data;
}
