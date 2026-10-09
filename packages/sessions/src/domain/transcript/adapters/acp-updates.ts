// ACP `session/update` notifications, read the way both of their readers need: the live stream of `/acp` and the
// Grok adapter, whose `updates.jsonl` stores the same notifications. Like every log reader, this module reads
// leniently and imports no package, because the Grok usage decoder in `/transcript/usage` uses it too.

import type { TranscriptEventKind, TranscriptStreamPart } from "../index.js";
import { compactUsage, type Usage } from "../../usage/index.js";
import { asNumber, asRecord, asString } from "./record-fields.js";

/** The `session/update` body, whether it sits under `params` or on the record. */
export function acpUpdateOf(value: unknown): Record<string, unknown> | undefined {
  const record = asRecord(value);
  return asRecord(asRecord(record?.params)?.update) ?? asRecord(record?.update);
}

/** Text of a message chunk: a string, `{ text }`, or parts whose text is nested under `content`. */
export function acpChunkText(content: unknown): string {
  const direct = asString(asRecord(content)?.text);
  if (direct) {
    return direct;
  }
  if (typeof content === "string") {
    return content;
  }
  if (!Array.isArray(content)) {
    return "";
  }
  return content
    .map((part) => {
      const inner = asRecord(part);
      const nested = asRecord(inner?.content);
      return asString(nested?.text) ?? asString(inner?.text) ?? "";
    })
    .join("");
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

/**
 * Merges one `tool_call` or `tool_call_update` into the state of its call, creating the state on first sight. An
 * update may carry only the fields that changed: only an omitted or `null` `rawInput`, `content` or `rawOutput` leaves
 * the previous value. Text content wins over `rawOutput` as the output.
 */
export function mergeAcpToolUpdate(
  tools: Map<string, AcpToolState>,
  update: Record<string, unknown>
): { readonly state: AcpToolState; readonly first: boolean } {
  const callId = asString(update.toolCallId) ?? "";
  const existing = tools.get(callId);
  const state: AcpToolState = existing ?? { callId, name: "" };
  tools.set(callId, state);
  const name = asString(update.title) ?? asString(update.toolName);
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
  const status = asString(update.status);
  if (status) {
    state.status = status;
  }
  return { state, first: existing === undefined };
}

/** `undefined` and `null` are omissions. Every other value, including `""`, `[]` and `{}`, replaces the field. */
function supplied(value: unknown): boolean {
  return value !== undefined && value !== null;
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

/**
 * Usage of a `session/prompt` response (ACP marks it unstable). ACP's `totalTokens` sums every count, so its
 * `inputTokens` leaves out cache reads and writes and its `outputTokens` leaves out thought tokens; both are added
 * back for the kit's convention, where they are subsets.
 */
export function acpUsage(value: unknown): Usage | undefined {
  const raw = asRecord(value);
  if (!raw) {
    return undefined;
  }
  const input = asNumber(raw.inputTokens);
  const output = asNumber(raw.outputTokens);
  const cacheRead = asNumber(raw.cachedReadTokens);
  const cacheWrite = asNumber(raw.cachedWriteTokens);
  const thought = asNumber(raw.thoughtTokens);
  return compactUsage({
    inputTokens: input === undefined ? undefined : input + (cacheRead ?? 0) + (cacheWrite ?? 0),
    outputTokens: output === undefined ? undefined : output + (thought ?? 0),
    totalTokens: asNumber(raw.totalTokens),
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

  const tool = (update: Record<string, unknown>): TranscriptStreamPart[] => {
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

  return {
    update(update) {
      const sessionUpdate = asString(update.sessionUpdate) ?? "update";
      const messageKind = acpMessageKind(sessionUpdate);
      if (messageKind !== undefined) {
        const text = acpChunkText(update.content);
        if (!text) {
          return [];
        }
        const messageId = asString(update.messageId);
        if (messageKind === "user") {
          return other("user", { text }, update);
        }
        return chunk(messageKind === "assistant" ? "text" : "reasoning", text, messageId);
      }
      if (sessionUpdate === "tool_call" || sessionUpdate === "tool_call_update") {
        return tool(update);
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
