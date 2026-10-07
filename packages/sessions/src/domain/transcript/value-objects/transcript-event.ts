import type { Usage } from "../../usage/index.js";
import type { SourcePointer } from "./source-pointer.js";

export type TranscriptEventKind =
  | "user"
  | "assistant"
  | "reasoning"
  | "tool_call"
  | "tool_result"
  | "request"
  | "system"
  | "compaction"
  | "hook"
  | "unknown";

export const TRANSCRIPT_EVENT_KINDS: readonly TranscriptEventKind[] = [
  "user",
  "assistant",
  "reasoning",
  "tool_call",
  "tool_result",
  "request",
  "system",
  "compaction",
  "hook",
  "unknown"
];

/**
 * One event of a Transcript. Events form a flat list and reference each other by id: `agentId` names a lane in
 * `Transcript.agents`, `parentId` the event this one follows in the agent's own record chain, `requestId` the
 * `request` event of the model request that produced it, `payload.callId` pairs a `tool_result` with its
 * `tool_call`, and `shadowedBy` names the compaction that removed it from the model's context. The payload shapes
 * per kind are the `*Payload` types; an agent may add fields of its own.
 */
export interface TranscriptEvent {
  /** Stable across loads of the same files. */
  id: string;
  /** The event's index in `Transcript.events`. */
  seq: number;
  /**
   * Epoch milliseconds, never 0; a record without a time takes the previous record's. Order is `seq`, not `ts`:
   * an agent may write a record with an earlier time than the one before it.
   */
  ts: number;
  kind: TranscriptEventKind;
  agentId?: string;
  parentId?: string;
  requestId?: string;
  shadowedBy?: string;
  payload: Record<string, unknown>;
  source: SourcePointer;
  /** The parsed record at `source`. Several events of one record share it. */
  original?: unknown;
}

/**
 * `user` and `assistant`: text, or one image block. A `user` event that is not a real prompt carries one of the flags
 * `meta`, `compactSummary`, `command` (a slash-command or shell wrapper), `injected` (text the agent put in the user
 * role) or `continued` (a later chunk of one prompt).
 */
export interface MessagePayload {
  text?: string;
  image?: boolean;
  mediaType?: string;
  meta?: boolean;
  compactSummary?: boolean;
  command?: boolean;
  injected?: boolean;
  continued?: boolean;
}

export interface ReasoningPayload {
  text?: string;
  /** The agent recorded that reasoning happened but not its text. */
  redacted?: boolean;
}

/** gen_ai.tool.call.id, gen_ai.tool.name */
export interface ToolCallPayload {
  callId: string;
  name: string;
  args?: unknown;
}

export interface ToolResultPayload {
  callId: string;
  output?: unknown;
  isError?: boolean;
  exitCode?: number;
  /** No `tool_call` with the same `callId` precedes it on the same lane. */
  orphan?: boolean;
}

export interface RequestPayload {
  /** gen_ai.request.model */
  model?: string;
  /** gen_ai.response.id */
  responseId?: string;
  usage?: Usage;
  startedAt?: number;
  durationMs?: number;
  /** gen_ai.response.finish_reasons[0] */
  finishReason?: string;
}

export interface CompactionPayload {
  trigger?: "auto" | "manual";
  preTokens?: number;
  postTokens?: number;
  summaryEventId?: string;
}

/** `system` events carry a `type`, such as `turn_duration` (with `durationMs`) or `prompt_snapshot`. */
export interface SystemPayload {
  type?: string;
  text?: string;
  durationMs?: number;
}

/**
 * A `system` event with `type: 'prompt_snapshot'`: the system prompt and tool definitions the agent recorded at
 * that point on the event's lane. A later snapshot on the same lane replaces an earlier one; a field left out was
 * not recorded by that snapshot.
 */
export interface PromptSnapshotPayload {
  type: "prompt_snapshot";
  systemPrompt?: string;
  tools?: unknown[];
}

export interface HookPayload {
  type: string;
  name?: string;
  event?: string;
  exitCode?: number;
}

/** An `unknown` event keeps the record or block type the adapter did not recognize. */
export interface UnknownPayload {
  type: string;
}
