import * as z from "zod/mini";

import { lenient, type Usage } from "@rivus/agent-kit-sessions/spi";
import { geminiCliUsage } from "../usage.js";

/** One tool call of a `gemini` message, as the message's latest copy shows it. */
export interface GeminiCliToolCall {
  /** The call's id, which every later copy of the message repeats. */
  id: string;
  /** The tool's name; empty when the record names none. */
  name: string;
  args: unknown;
  /**
   * How the call ended: `success`, `error` or `canceled`, where a canceled call was refused, not failed. `undefined`
   * while the call runs or awaits confirmation.
   */
  result: { isError: boolean; output: string | undefined } | undefined;
}

/** A line of the chat itself: every one may repeat the chat's session id. */
type GeminiCliChatLine = { sessionId: string | undefined } & (
  | { kind: "header" }
  | { kind: "user"; text: string | undefined }
  | {
      kind: "gemini";
      /** The CLI appends the message again whenever it changes; the copies share this id. */
      id: string;
      text: string | undefined;
      model: string | undefined;
      usage: Usage | undefined;
      toolCalls: GeminiCliToolCall[];
      /** The `toolCalls` entries that are not a call with an id. */
      invalidToolCalls: number;
    }
  | { kind: "thinking"; text: string | undefined }
  | { kind: "compression"; preTokens: number | undefined; postTokens: number | undefined }
  | { kind: "compression-pending" }
  /** An `info`, `warning` or `error` item, or a typed line without an id: a notice the CLI shows in place. */
  | { kind: "notice"; type: string; text: string | undefined }
  /** An item of a type this reader does not know. */
  | { kind: "unknown"; type: string }
);

/**
 * What one record of a chat file is, decided once here so the translation only switches on `kind`. A `.jsonl`
 * chat's first line is its header (`{ sessionId, projectHash, startTime, lastUpdated, kind }`, no `id` and no
 * `type`); the lines after are the CLI's chat items, and `$patch` and `$set` markers amend an earlier message's
 * content and the chat's stored fields. `invalid` is a record that is not a JSON object, or a `$patch` marker that
 * names no message.
 */
export type GeminiCliChatItem =
  | { kind: "invalid" }
  | { kind: "patch"; messageId: string; content: string | undefined }
  | { kind: "set" }
  | GeminiCliChatLine;

// A call is followed through the message's later copies by its id, so an entry without one is dropped.
const GeminiCliToolCallRecord = z.object({
  id: z.string().check(z.minLength(1)),
  name: lenient(z.string()),
  status: lenient(z.string()),
  args: z.optional(z.unknown()),
  resultDisplay: lenient(z.string())
});

// Strip mode copies only the fields named here. A lenient field keeps its key when the value is mistyped, so
// `Object.hasOwn` on the parsed record still tells a marker by its key.
const GeminiCliChatRecord = z.object({
  id: lenient(z.string()),
  type: lenient(z.string()),
  content: lenient(z.string()),
  model: lenient(z.string()),
  sessionId: lenient(z.string()),
  tokens: z.optional(z.unknown()),
  toolCalls: lenient(z.array(lenient(GeminiCliToolCallRecord))),
  thought: lenient(z.object({ subject: lenient(z.string()), description: lenient(z.string()) })),
  compression: lenient(
    z.object({
      isPending: lenient(z.boolean()),
      originalTokenCount: lenient(z.number()),
      newTokenCount: lenient(z.number())
    })
  ),
  $patch: lenient(z.object({ id: z.union([z.string(), z.number()]), content: lenient(z.string()) })),
  $set: z.optional(z.unknown())
});

type GeminiCliChatRecordValue = z.output<typeof GeminiCliChatRecord>;

function toolCallsOf(entries: GeminiCliChatRecordValue["toolCalls"]): {
  toolCalls: GeminiCliToolCall[];
  invalidToolCalls: number;
} {
  const toolCalls: GeminiCliToolCall[] = [];
  let invalidToolCalls = 0;
  for (const call of entries ?? []) {
    if (call === undefined) {
      invalidToolCalls += 1;
      continue;
    }
    const ended = call.status === "success" || call.status === "error" || call.status === "canceled";
    toolCalls.push({
      id: call.id,
      name: call.name ?? "",
      args: call.args,
      result: ended ? { isError: call.status === "error", output: call.resultDisplay } : undefined
    });
  }
  return { toolCalls, invalidToolCalls };
}

function chatLine(record: GeminiCliChatRecordValue): GeminiCliChatLine {
  const { id, type, content: text, sessionId } = record;
  if (id === undefined) {
    return type === undefined ? { kind: "header", sessionId } : { kind: "notice", sessionId, type, text };
  }
  switch (type) {
    case "user":
      return { kind: "user", sessionId, text };
    case "gemini":
      return {
        kind: "gemini",
        sessionId,
        id,
        text,
        model: record.model,
        usage: geminiCliUsage(record.tokens),
        ...toolCallsOf(record.toolCalls)
      };
    case "thinking":
      return { kind: "thinking", sessionId, text: record.thought?.description ?? record.thought?.subject };
    case "compression": {
      const compression = record.compression;
      return compression?.isPending === true
        ? { kind: "compression-pending", sessionId }
        : {
            kind: "compression",
            sessionId,
            preTokens: compression?.originalTokenCount,
            postTokens: compression?.newTokenCount
          };
    }
    case "info":
    case "warning":
    case "error":
      return { kind: "notice", sessionId, type, text };
    default:
      return { kind: "unknown", sessionId, type: type ?? "unknown" };
  }
}

/** What a record's value is as a line of a chat; see `GeminiCliChatItem`. */
export function geminiCliChatItem(value: unknown): GeminiCliChatItem {
  const record = z.safeParse(GeminiCliChatRecord, value).data;
  if (record === undefined) {
    return { kind: "invalid" };
  }
  if (Object.hasOwn(record, "$patch")) {
    const patch = record.$patch;
    return patch === undefined
      ? { kind: "invalid" }
      : { kind: "patch", messageId: String(patch.id), content: patch.content };
  }
  if (Object.hasOwn(record, "$set")) {
    return { kind: "set" };
  }
  return chatLine(record);
}
