import type { Usage } from "../../usage/index.js";
import type { SourcePointer } from "./source-pointer.js";

/**
 * The payload type of each event kind. Code generic over the kind, such as a function that builds a
 * `TranscriptEventOf<K>`, types its payload as `TranscriptEventPayloads[K]`: while `K` is a type parameter, TypeScript
 * does not resolve `TranscriptEventOf<K>['payload']`, so an event built from such a payload does not check as a
 * `TranscriptEventOf<K>`.
 */
export interface TranscriptEventPayloads {
  user: MessagePayload;
  assistant: MessagePayload;
  reasoning: ReasoningPayload;
  tool_call: ToolCallPayload;
  tool_result: ToolResultPayload;
  request: RequestPayload;
  system: SystemPayload;
  compaction: CompactionPayload;
  hook: HookPayload;
  unknown: UnknownPayload;
}

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

/** A TranscriptEvent of one kind. */
export interface TranscriptEventBase<K extends TranscriptEventKind> {
  /** Stable across loads of the same files. */
  id: string;
  /** The event's index in `Transcript.events`. */
  seq: number;
  /**
   * Epoch milliseconds, never 0; a record without a time takes the previous record's. Order is `seq`, not `ts`:
   * an agent may write a record with an earlier time than the one before it.
   */
  ts: number;
  kind: K;
  agentId?: string;
  parentId?: string;
  requestId?: string;
  shadowedBy?: string;
  payload: TranscriptEventPayloads[K];
  source: SourcePointer;
  /** The parsed record at `source`. Several events of one record share it. */
  original?: unknown;
}

/**
 * The events of the kinds in `K`, such as `TranscriptEventOf<'tool_call'>`; a union of kinds gives a union of
 * events, each with its own payload type.
 */
export type TranscriptEventOf<K extends TranscriptEventKind> = { [Kind in K]: TranscriptEventBase<Kind> }[K];

/**
 * One event of a Transcript. Events form a flat list and reference each other by id: `agentId` names a lane in
 * `Transcript.agents`, `parentId` the event this one follows in the agent's own record chain, `requestId` the
 * `request` event of the model request that produced it, `payload.callId` pairs a `tool_result` with its
 * `tool_call`, and `shadowedBy` names the compaction that removed it from the model's context. The union is
 * discriminated by `kind`: narrowing on it types `payload` as that kind's `*Payload`. An agent may add fields of its
 * own to a payload, which read as `unknown`.
 */
export type TranscriptEvent = TranscriptEventOf<TranscriptEventKind>;

/**
 * A `kind` with the payload of that kind, for code that builds events: a union over the kinds in `K`, so narrowing
 * on `kind` types `payload`.
 */
export type TranscriptEventBody<K extends TranscriptEventKind = TranscriptEventKind> = {
  [Kind in K]: { kind: Kind; payload: TranscriptEventPayloads[Kind] };
}[K];

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
  [field: string]: unknown;
}

export interface ReasoningPayload {
  text?: string;
  /** The agent recorded that reasoning happened but not its text. */
  redacted?: boolean;
  [field: string]: unknown;
}

/** gen_ai.tool.call.id, gen_ai.tool.name */
export interface ToolCallPayload {
  callId: string;
  name: string;
  /** The display title ACP reports while it differs from `name`, such as `` Read `/u/me/x.md` ``. */
  title?: string;
  args?: unknown;
  [field: string]: unknown;
}

export interface ToolResultPayload {
  callId: string;
  output?: unknown;
  isError?: boolean;
  exitCode?: number;
  /** No `tool_call` with the same `callId` precedes it on the same lane. */
  orphan?: boolean;
  [field: string]: unknown;
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
  /**
   * What `usage` covers: one model request, one turn, or the whole session. An aggregate stays an aggregate
   * and is not split into invented per-request records.
   */
  granularity?: "request" | "turn" | "session";
  /** How many model calls a `turn` or `session` aggregate covers. */
  modelCalls?: number;
  /** The same usage split by model. A total uses `usage` or this split, not the two added together. */
  usageByModel?: Record<string, { usage: Usage; modelCalls?: number }>;
  [field: string]: unknown;
}

export interface CompactionPayload {
  trigger?: "auto" | "manual";
  preTokens?: number;
  postTokens?: number;
  summaryEventId?: string;
  [field: string]: unknown;
}

/**
 * `system` events carry a `type`, such as `turn_duration` (with `durationMs`) or `prompt_snapshot` (with
 * `systemPrompt` and `tools`, see `PromptSnapshotPayload`); instructions an agent sent without one carry `text`, and
 * Codex's developer messages also carry `injected: true`. The snapshot fields are declared here rather than on a
 * member of a union: the other `type`s are open strings, which could not narrow such a union on
 * `type: 'prompt_snapshot'`.
 */
export interface SystemPayload {
  type?: string;
  text?: string;
  durationMs?: number;
  systemPrompt?: string;
  tools?: unknown[];
  [field: string]: unknown;
}

/**
 * A `system` event with `type: 'prompt_snapshot'`: the system prompt and tool definitions the agent recorded at
 * that point on the event's lane. A later snapshot on the same lane replaces an earlier one; a field left out was
 * not recorded by that snapshot. `promptSnapshot` returns it for such an event.
 */
export interface PromptSnapshotPayload extends SystemPayload {
  type: "prompt_snapshot";
}

export interface HookPayload {
  type: string;
  name?: string;
  event?: string;
  exitCode?: number;
  [field: string]: unknown;
}

/** An `unknown` event keeps the record or block type the adapter did not recognize. */
export interface UnknownPayload {
  type: string;
  [field: string]: unknown;
}
