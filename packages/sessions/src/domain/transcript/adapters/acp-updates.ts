// ACP `session/update` notifications, read the way both of their readers need: the live stream of `/acp` and the
// Grok adapter, whose `updates.jsonl` stores the same notifications. Like every log reader, this module reads
// leniently. It is bundled into the zero-dependency `/transcript/usage` entry, whose built files import nothing
// because `vp pack` bundles `zod/mini` into that entry and keeps it external for every other entry.

import * as z from "zod/mini";

import { timeOf, type TranscriptEventKind, type TranscriptStreamPart } from "../index.js";
import { compactUsage, type Usage } from "../../usage/index.js";
import { lenient } from "./lenient.js";
import { logTimestamp } from "./timestamp.js";

/** The body fields `AcpUpdate` parses, as a plain type: adapters that repeat the fields in their own schema assert
 * their set against this one. */
export type AcpUpdateField =
  | "sessionUpdate"
  | "content"
  | "messageId"
  | "toolCallId"
  | "title"
  | "toolName"
  | "rawInput"
  | "rawOutput"
  | "status";

/**
 * The `session/update` body as this module reads it. Fields it does not name stay on the record, so Grok's `_meta`
 * and `usage` reach the grok adapters unchanged.
 */
export interface AcpUpdateValue {
  sessionUpdate?: string;
  /** Text, a `{ text }` block, or content parts; kept as received, like `rawInput` and `rawOutput`. */
  content?: unknown;
  messageId?: string;
  toolCallId?: string;
  title?: string;
  toolName?: string;
  rawInput?: unknown;
  rawOutput?: unknown;
  status?: string;
  [field: string]: unknown;
}

/**
 * The `session/update` body, one field per reader; a field of an unexpected type counts as absent. The schema stays
 * module-private: an exported declaration typed by zod drags zod's declarations into the dts of the entries that
 * bundle this module, and those must import nothing.
 */
const AcpUpdate = z.looseObject({
  sessionUpdate: lenient(z.string()),
  content: lenient(z.unknown()),
  messageId: lenient(z.string()),
  toolCallId: lenient(z.string()),
  title: lenient(z.string()),
  toolName: lenient(z.string()),
  rawInput: lenient(z.unknown()),
  rawOutput: lenient(z.unknown()),
  status: lenient(z.string())
});

/** The `session/update` notification record: the body under `params`, or on the record itself, and the record time. */
const AcpUpdateEnvelope = z.looseObject({
  timestamp: logTimestamp,
  params: lenient(z.looseObject({ update: lenient(AcpUpdate) })),
  update: lenient(AcpUpdate)
});

/**
 * The body of a recorded `session/update`, under `params` or on the record, with the record's own time in epoch
 * milliseconds beside it, so a reader gets both off one parse. Both are `undefined` when the value is not a record
 * or the record carries no body.
 */
export function acpRecordedUpdate(value: unknown): { update: AcpUpdateValue | undefined; time: number | undefined } {
  const record = z.safeParse(AcpUpdateEnvelope, value).data;
  return { update: record?.params?.update ?? record?.update, time: timeOf(record?.timestamp) };
}

/** Text of one content part: the part's `text`, else the text of the block nested under its `content`. */
const AcpChunkPart = z.looseObject({
  text: lenient(z.string()),
  content: lenient(z.looseObject({ text: lenient(z.string()) }))
});

/** Content of a message chunk: a string, a `{ text }` block, or such parts. */
const AcpChunkContent = z.union([z.string(), AcpChunkPart, z.array(lenient(AcpChunkPart))]);

/** Text of a message chunk: a string, `{ text }`, or parts whose text is nested under `content`. */
export function acpChunkText(content: unknown): string {
  const parsed = z.safeParse(AcpChunkContent, content).data;
  if (typeof parsed === "string") {
    return parsed;
  }
  if (Array.isArray(parsed)) {
    return parsed.map((part) => part?.content?.text ?? part?.text ?? "").join("");
  }
  return parsed?.text ?? "";
}

const MESSAGE_KINDS: Readonly<Record<string, "user" | "assistant" | "reasoning">> = {
  user_message_chunk: "user",
  agent_message_chunk: "assistant",
  agent_thought_chunk: "reasoning"
};

/** The event kind of a message chunk update, or `undefined` for every other update. */
export function acpMessageKind(sessionUpdate: string): "user" | "assistant" | "reasoning" | undefined {
  return Object.hasOwn(MESSAGE_KINDS, sessionUpdate) ? MESSAGE_KINDS[sessionUpdate] : undefined;
}

/** What one tool call has reported so far, merged from its `tool_call` and `tool_call_update` updates. */
export interface AcpToolState {
  readonly callId: string;
  name: string;
  args?: unknown;
  output?: unknown;
  status?: string;
}

const TOOL_DONE = new Set(["completed", "failed", "error"]);

/** `undefined` and `null` are omissions. Every other value, including `""`, `[]` and `{}`, replaces the field. */
function supplied(value: unknown): boolean {
  return value !== undefined && value !== null;
}

/**
 * Merges one `tool_call` or `tool_call_update` into the state of its call, creating the state on first sight. An
 * update may carry only the fields that changed: only an omitted or `null` `rawInput`, `content` or `rawOutput` leaves
 * the previous value. Text content wins over `rawOutput` as the output.
 */
export function mergeAcpToolUpdate(
  tools: Map<string, AcpToolState>,
  update: AcpUpdateValue
): { readonly state: AcpToolState; readonly first: boolean } {
  const callId = update.toolCallId ?? "";
  const existing = tools.get(callId);
  const state: AcpToolState = existing ?? { callId, name: "" };
  tools.set(callId, state);
  const name = update.title ?? update.toolName;
  if (name) {
    state.name = name;
  }
  if (supplied(update.rawInput)) {
    state.args = update.rawInput;
  }
  if (supplied(update.content)) {
    const text = acpChunkText(update.content);
    state.output = text.length > 0 ? text : update.content;
  } else if (supplied(update.rawOutput)) {
    state.output = update.rawOutput;
  }
  const status = update.status;
  if (status) {
    state.status = status;
  }
  return { state, first: existing === undefined };
}

/** A call has ended once its status is `completed`, `failed` or `error`. */
export function isAcpToolDone(state: AcpToolState): boolean {
  return state.status !== undefined && TOOL_DONE.has(state.status);
}

/** A call that ended with any status other than `completed` failed. */
export function isAcpToolError(state: AcpToolState): boolean {
  return state.status !== "completed";
}

export function acpToolCallPayload(state: AcpToolState): Record<string, unknown> {
  return { callId: state.callId, name: state.name, ...(state.args === undefined ? {} : { args: state.args }) };
}

export function acpToolResultPayload(state: AcpToolState): Record<string, unknown> {
  return {
    callId: state.callId,
    isError: isAcpToolError(state),
    ...(state.output === undefined ? {} : { output: state.output })
  };
}

/** The text a UI shows for a failed call: its text output, else its status. */
function errorText(state: AcpToolState): string {
  return typeof state.output === "string" && state.output !== "" ? state.output : `the tool call ${state.status}`;
}

/** ACP updates about the session rather than the conversation; the live stream keeps them as `system` events. */
const SESSION_UPDATES = new Set([
  "plan",
  "available_commands_update",
  "current_mode_update",
  "config_option_update",
  "session_info_update",
  "usage_update"
]);

/** Token counts of a `session/prompt` response (ACP marks it unstable). */
const AcpResponseUsage = z.looseObject({
  inputTokens: lenient(z.number()),
  outputTokens: lenient(z.number()),
  cachedReadTokens: lenient(z.number()),
  cachedWriteTokens: lenient(z.number()),
  thoughtTokens: lenient(z.number()),
  totalTokens: lenient(z.number())
});

/**
 * Usage of a `session/prompt` response (ACP marks it unstable). ACP's `totalTokens` sums every count, so its
 * `inputTokens` leaves out cache reads and writes and its `outputTokens` leaves out thought tokens; both are added
 * back for the kit's convention, where they are subsets.
 */
export function acpUsage(value: unknown): Usage | undefined {
  const raw = z.safeParse(AcpResponseUsage, value).data;
  if (!raw) {
    return undefined;
  }
  const input = raw.inputTokens;
  const output = raw.outputTokens;
  const cacheRead = raw.cachedReadTokens;
  const cacheWrite = raw.cachedWriteTokens;
  const thought = raw.thoughtTokens;
  return compactUsage({
    inputTokens: input === undefined ? undefined : input + (cacheRead ?? 0) + (cacheWrite ?? 0),
    outputTokens: output === undefined ? undefined : output + (thought ?? 0),
    totalTokens: raw.totalTokens,
    cacheReadTokens: cacheRead,
    cacheWriteTokens: cacheWrite,
    reasoningTokens: thought
  });
}

/** Translates one session's live updates into stream parts. */
export interface AcpPartTranslator {
  /** The parts of one `session/update` body. */
  update(update: Record<string, unknown>): TranscriptStreamPart[];
  /** Closes what is still open and ends the turn with the `session/prompt` response. */
  finish(response: { readonly stopReason: string; readonly usage?: unknown }): TranscriptStreamPart[];
}

/**
 * A translator for one session. Part ids start with `prefix` and count up, so they stay unique across the turns of
 * the session. A text or reasoning part runs until another kind of update arrives, or a chunk names another
 * `messageId`; a tool call reports its input whenever an update supplies one and its output once, when it ends.
 */
export function createAcpPartTranslator(prefix: string): AcpPartTranslator {
  let counter = 0;
  const nextId = () => `${prefix}${counter++}`;
  const tools = new Map<string, AcpToolState>();
  const ended = new Set<string>();
  let open: { readonly kind: "text" | "reasoning"; readonly id: string; readonly messageId?: string } | undefined;

  const close = (): TranscriptStreamPart[] => {
    if (open === undefined) {
      return [];
    }
    const part: TranscriptStreamPart =
      open.kind === "text" ? { type: "text-end", id: open.id } : { type: "reasoning-end", id: open.id };
    open = undefined;
    return [part];
  };

  const chunk = (kind: "text" | "reasoning", text: string, messageId: string | undefined): TranscriptStreamPart[] => {
    const parts: TranscriptStreamPart[] = [];
    if (open === undefined || open.kind !== kind || open.messageId !== messageId) {
      parts.push(...close());
      const id = nextId();
      open = messageId === undefined ? { kind, id } : { kind, id, messageId };
      parts.push(kind === "text" ? { type: "text-start", id } : { type: "reasoning-start", id });
    }
    const { id } = open;
    parts.push(
      kind === "text" ? { type: "text-delta", id, delta: text } : { type: "reasoning-delta", id, delta: text }
    );
    return parts;
  };

  const tool = (update: AcpUpdateValue): TranscriptStreamPart[] => {
    const parts = close();
    const { state, first } = mergeAcpToolUpdate(tools, update);
    const { callId: toolCallId, name: toolName } = state;
    if (first) {
      parts.push({ type: "tool-input-start", toolCallId, toolName });
    }
    if (supplied(update.rawInput)) {
      parts.push({ type: "tool-input-available", toolCallId, toolName, input: state.args });
    }
    if (isAcpToolDone(state) && !ended.has(toolCallId)) {
      ended.add(toolCallId);
      const output = state.output === undefined ? {} : { output: state.output };
      parts.push(
        isAcpToolError(state)
          ? { type: "tool-output-error", toolCallId, errorText: errorText(state), ...output }
          : { type: "tool-output-available", toolCallId, ...output }
      );
    }
    return parts;
  };

  const other = (kind: TranscriptEventKind, payload: Record<string, unknown>, original: unknown) => [
    ...close(),
    { type: "update", id: nextId(), kind, payload, original } satisfies TranscriptStreamPart
  ];

  // An empty record parses to an all-absent update; it stands in when the body is not a record at all.
  const noUpdate: AcpUpdateValue = z.parse(AcpUpdate, {});

  return {
    update(update) {
      const body = z.safeParse(AcpUpdate, update).data ?? noUpdate;
      const sessionUpdate = body.sessionUpdate ?? "update";
      const messageKind = acpMessageKind(sessionUpdate);
      if (messageKind !== undefined) {
        const text = acpChunkText(body.content);
        if (!text) {
          return [];
        }
        const messageId = body.messageId;
        if (messageKind === "user") {
          return other("user", { text }, update);
        }
        return chunk(messageKind === "assistant" ? "text" : "reasoning", text, messageId);
      }
      if (sessionUpdate === "tool_call" || sessionUpdate === "tool_call_update") {
        return tool(body);
      }
      return other(SESSION_UPDATES.has(sessionUpdate) ? "system" : "unknown", { type: sessionUpdate }, update);
    },
    finish(response) {
      const usage = acpUsage(response.usage);
      return [
        ...close(),
        {
          type: "finish",
          id: nextId(),
          finishReason: response.stopReason,
          ...(usage === undefined ? {} : { usage })
        }
      ];
    }
  };
}
