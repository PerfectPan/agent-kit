import { err, ok, type Result } from "@rivus/agent-kit-catalog/spi";
import {
  compactUsage,
  lenient,
  logTimestamp,
  type SourcePointer,
  type SourcedRecord,
  type UnknownFormatGeneration,
  unknownFormatGeneration,
  type Usage
} from "@rivus/agent-kit-sessions/spi";
import * as z from "zod/mini";

import { PI_ID } from "./facts.js";

/** The `version` of the session file this adapter reads. Pi migrates older files before it appends to them. */
export const PI_SESSION_VERSION = 3;

const PiUsage = z.looseObject({
  input: lenient(z.number()),
  output: lenient(z.number()),
  cacheRead: lenient(z.number()),
  cacheWrite: lenient(z.number()),
  totalTokens: lenient(z.number())
});

export interface PiUsageValue {
  input?: number;
  output?: number;
  cacheRead?: number;
  cacheWrite?: number;
  totalTokens?: number;
}

/**
 * Pi counts `input` without the cache (`totalTokens` is input + output + cacheRead + cacheWrite); the kit counts cache
 * reads and writes inside `inputTokens`. Reasoning is part of `output`, and Pi logs no separate reasoning count.
 */
export function piUsageOf(usage: PiUsageValue | undefined): Usage | undefined {
  if (!usage) {
    return undefined;
  }
  const cacheRead = usage.cacheRead ?? 0;
  const cacheWrite = usage.cacheWrite ?? 0;
  const hasInput = usage.input !== undefined || cacheRead > 0 || cacheWrite > 0;
  return compactUsage({
    ...(hasInput ? { inputTokens: (usage.input ?? 0) + cacheRead + cacheWrite } : {}),
    ...(usage.output === undefined ? {} : { outputTokens: usage.output }),
    ...(usage.cacheRead === undefined ? {} : { cacheReadTokens: usage.cacheRead }),
    ...(usage.cacheWrite === undefined ? {} : { cacheWriteTokens: usage.cacheWrite }),
    ...(usage.totalTokens === undefined ? {} : { totalTokens: usage.totalTokens })
  });
}

export function piUsage(value: unknown): Usage | undefined {
  return piUsageOf(z.safeParse(PiUsage, value).data);
}

const PiMessage = z.looseObject({
  role: z.string(),
  content: lenient(z.union([z.string(), z.array(z.unknown())])),
  provider: lenient(z.string()),
  model: lenient(z.string()),
  usage: lenient(PiUsage),
  stopReason: lenient(z.string()),
  responseId: lenient(z.string()),
  toolCallId: lenient(z.string()),
  toolName: lenient(z.string()),
  isError: lenient(z.boolean()),
  command: lenient(z.string()),
  output: lenient(z.string()),
  exitCode: lenient(z.number()),
  cancelled: lenient(z.boolean()),
  excludeFromContext: lenient(z.boolean())
});

export interface PiMessageValue {
  role: string;
  content?: string | readonly unknown[];
  provider?: string;
  model?: string;
  usage?: PiUsageValue;
  stopReason?: string;
  responseId?: string;
  summary?: string;
  fromId?: string;
  toolCallId?: string;
  toolName?: string;
  isError?: boolean;
  command?: string;
  output?: string;
  exitCode?: number;
  cancelled?: boolean;
  excludeFromContext?: boolean;
}

const PiEntry = z.looseObject({
  type: z.string(),
  id: lenient(z.string()),
  parentId: lenient(z.string()),
  timestamp: logTimestamp,
  message: lenient(PiMessage),
  summary: lenient(z.string()),
  firstKeptEntryId: lenient(z.string()),
  tokensBefore: lenient(z.number()),
  provider: lenient(z.string()),
  modelId: lenient(z.string()),
  name: lenient(z.string()),
  thinkingLevel: lenient(z.string()),
  fromId: lenient(z.string()),
  customType: lenient(z.string()),
  content: lenient(z.union([z.string(), z.array(z.unknown())])),
  display: lenient(z.boolean())
});

export interface PiEntryValue {
  type: string;
  id?: string;
  parentId?: string;
  timestamp?: string | number;
  message?: PiMessageValue;
  summary?: string;
  firstKeptEntryId?: string;
  tokensBefore?: number;
  provider?: string;
  modelId?: string;
  name?: string;
  thinkingLevel?: string;
  fromId?: string;
  customType?: string;
  content?: string | readonly unknown[];
  display?: boolean;
}

const PiHeader = z.looseObject({
  type: z.literal("session"),
  version: lenient(z.number()),
  id: lenient(z.string()),
  timestamp: logTimestamp,
  cwd: lenient(z.string()),
  parentSession: lenient(z.string())
});

export interface PiHeaderValue {
  type: "session";
  version?: number;
  id?: string;
  timestamp?: string | number;
  cwd?: string;
  parentSession?: string;
}

/** The session header, when `value` is one. Unrelated lines parse as no header. */
export function piHeaderOf(value: unknown): PiHeaderValue | undefined {
  return z.safeParse(PiHeader, value).data;
}

/** Any session entry. The header parses as an entry with `type: "session"` and no other fields. */
export function piEntryOf(value: unknown): PiEntryValue | undefined {
  return z.safeParse(PiEntry, value).data;
}

/**
 * The generation check every read shares: the first record must be a version this adapter reads. `file` names the
 * session in the error when the file is empty.
 */
export function piGenerationOf(
  records: readonly SourcedRecord[],
  file: SourcePointer
): Result<PiHeaderValue, UnknownFormatGeneration> {
  const first = records[0];
  if (first === undefined) {
    return err(unknownFormatGeneration(PI_ID, file));
  }
  const header = piHeaderOf(first.value);
  if (header === undefined || header.version !== PI_SESSION_VERSION) {
    return err(unknownFormatGeneration(PI_ID, first));
  }
  return ok(header);
}

export type PiContentPart =
  | { kind: "text"; text: string }
  | { kind: "thinking"; text: string; redacted?: boolean }
  | { kind: "tool_call"; id: string; name: string; args: unknown }
  | { kind: "image"; mediaType?: string }
  | { kind: "unknown"; type: string };

const PiTextPart = z.looseObject({ type: z.literal("text"), text: z.string() });
const PiThinkingPart = z.looseObject({
  type: z.literal("thinking"),
  thinking: z.string(),
  redacted: lenient(z.boolean())
});
const PiToolCallPart = z.looseObject({
  type: z.literal("toolCall"),
  id: z.string(),
  name: z.string(),
  arguments: z.unknown()
});
const PiImagePart = z.looseObject({ type: z.literal("image"), mimeType: lenient(z.string()) });
const PiPartType = z.looseObject({ type: z.string() });

/** The parts of a user or assistant message; a string content is one text part. */
export function piContentParts(content: unknown): PiContentPart[] {
  if (typeof content === "string") {
    return [{ kind: "text", text: content }];
  }
  if (!Array.isArray(content)) {
    return [];
  }
  const out: PiContentPart[] = [];
  for (const raw of content) {
    const text = z.safeParse(PiTextPart, raw).data;
    if (text) {
      out.push({ kind: "text", text: text.text });
      continue;
    }
    const thinking = z.safeParse(PiThinkingPart, raw).data;
    if (thinking) {
      out.push({ kind: "thinking", text: thinking.thinking, ...(thinking.redacted ? { redacted: true } : {}) });
      continue;
    }
    const tool = z.safeParse(PiToolCallPart, raw).data;
    if (tool) {
      out.push({ kind: "tool_call", id: tool.id, name: tool.name, args: tool.arguments });
      continue;
    }
    const image = z.safeParse(PiImagePart, raw).data;
    if (image) {
      out.push({ kind: "image", ...(image.mimeType === undefined ? {} : { mediaType: image.mimeType }) });
      continue;
    }
    out.push({ kind: "unknown", type: z.safeParse(PiPartType, raw).data?.type ?? "unknown" });
  }
  return out;
}
