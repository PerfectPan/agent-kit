import * as z from "zod/mini";

import { lenient } from "../lenient.js";

// Codex writes one rollout record per line. Agent logs are read leniently: a field of an unexpected type counts as
// absent (./lenient.js), and only the record envelope decides whether the format generation is known.

/** A usage object as both `token_usage_record.usage` and `token_count.info` carry it. */
export interface CodexTokenCountsValue {
  input_tokens?: number;
  cached_input_tokens?: number;
  cache_write_input_tokens?: number;
  output_tokens?: number;
  reasoning_output_tokens?: number;
  total_tokens?: number;
  [key: string]: unknown;
}

const CodexTokenCounts = z.looseObject({
  input_tokens: lenient(z.number()),
  cached_input_tokens: lenient(z.number()),
  cache_write_input_tokens: lenient(z.number()),
  output_tokens: lenient(z.number()),
  reasoning_output_tokens: lenient(z.number()),
  total_tokens: lenient(z.number())
});

/** A history item of a `replacement_history`: the fields matching keeps, `content` kept raw for the text. */
export interface CodexHistoryItemValue {
  type?: string;
  role?: string;
  id?: string;
  call_id?: string;
  content?: unknown;
  [key: string]: unknown;
}

const CodexHistoryItem = z.looseObject({
  type: lenient(z.string()),
  role: lenient(z.string()),
  id: lenient(z.string()),
  call_id: lenient(z.string()),
  content: z.optional(z.unknown())
});

/**
 * The payload of a rollout record, whatever envelope carries it: the `session_meta` identity, the `turn_context`
 * model, the `event_msg` markers, the usage objects, and the fields of a response item or of a bare item of an older
 * rollout. Fields a reader does not name stay in the payload.
 */
export interface CodexPayloadValue {
  type?: string;
  role?: string;
  id?: string;
  call_id?: string;
  name?: string;
  status?: string;
  author?: string;
  recipient?: string;
  session_id?: string;
  cwd?: string;
  cli_version?: string;
  model?: string;
  turn_id?: string;
  response_id?: string;
  reason?: string;
  forked_from_id?: string;
  duration_ms?: number;
  content?: unknown;
  summary?: unknown;
  action?: unknown;
  arguments?: unknown;
  input?: unknown;
  tools?: unknown;
  output?: unknown;
  item?: {
    type?: string;
    id?: string;
    agent_thread_id?: string;
    agent_path?: string;
    kind?: string;
    [key: string]: unknown;
  };
  base_instructions?: { text?: string; [key: string]: unknown };
  thread_settings?: { service_tier?: string; [key: string]: unknown };
  source?: { subagent?: { thread_spawn?: unknown; [key: string]: unknown }; [key: string]: unknown };
  usage?: Record<string, unknown>;
  info?: {
    total_token_usage?: Record<string, unknown>;
    last_token_usage?: Record<string, unknown>;
    [key: string]: unknown;
  };
  replacement_history?: (CodexHistoryItemValue | undefined)[];
  [key: string]: unknown;
}

const CodexPayload = z.looseObject({
  type: lenient(z.string()),
  role: lenient(z.string()),
  id: lenient(z.string()),
  call_id: lenient(z.string()),
  name: lenient(z.string()),
  status: lenient(z.string()),
  author: lenient(z.string()),
  recipient: lenient(z.string()),
  session_id: lenient(z.string()),
  cwd: lenient(z.string()),
  cli_version: lenient(z.string()),
  model: lenient(z.string()),
  turn_id: lenient(z.string()),
  response_id: lenient(z.string()),
  reason: lenient(z.string()),
  forked_from_id: lenient(z.string()),
  duration_ms: lenient(z.number()),
  content: z.optional(z.unknown()),
  summary: z.optional(z.unknown()),
  action: z.optional(z.unknown()),
  arguments: z.optional(z.unknown()),
  input: z.optional(z.unknown()),
  tools: z.optional(z.unknown()),
  output: z.optional(z.unknown()),
  item: lenient(
    z.looseObject({
      type: lenient(z.string()),
      id: lenient(z.string()),
      agent_thread_id: lenient(z.string()),
      agent_path: lenient(z.string()),
      kind: lenient(z.string())
    })
  ),
  base_instructions: lenient(z.looseObject({ text: lenient(z.string()) })),
  thread_settings: lenient(z.looseObject({ service_tier: lenient(z.string()) })),
  source: lenient(z.looseObject({ subagent: lenient(z.looseObject({ thread_spawn: z.optional(z.unknown()) })) })),
  usage: lenient(z.record(z.string(), z.unknown())),
  info: lenient(
    z.looseObject({
      total_token_usage: lenient(z.record(z.string(), z.unknown())),
      last_token_usage: lenient(z.record(z.string(), z.unknown()))
    })
  ),
  replacement_history: lenient(z.array(lenient(CodexHistoryItem)))
});

/**
 * One rollout record: the envelope `type`, the `record_type` bookkeeping marker, and the header `id` of a
 * pre-envelope rollout. `payload` stays raw because only the record knows whether it is a bare item's record, whose
 * fields sit on the record itself; readers parse it through `codexPayload`.
 */
export interface CodexRecordValue {
  type?: string;
  record_type?: string;
  id?: string;
  payload?: unknown;
  [key: string]: unknown;
}

const CodexRecord = z.looseObject({
  type: lenient(z.string()),
  record_type: lenient(z.string()),
  id: lenient(z.string()),
  payload: z.optional(z.unknown())
});

/** A record whose envelope marks a format generation this adapter does not read. */
const FORMAT_VERSION = z.looseObject({ formatVersion: z.unknown() });

/** The envelopes of a known generation: a string `type`, a `record_type` marker, or an older rollout's header. */
const KNOWN_ENVELOPE = z.union([
  z.looseObject({ type: z.string() }),
  z.looseObject({ record_type: z.string() }),
  z.looseObject({ id: z.unknown(), timestamp: z.unknown() })
]);

/**
 * A record of a format generation this adapter reads: no `formatVersion`, and a string `type`, a `record_type`
 * bookkeeping marker, or the `timestamp` and `id` of an older rollout's header, whose presence is what counts, not
 * their type.
 */
export function knownCodexGeneration(value: unknown): boolean {
  return !z.safeParse(FORMAT_VERSION, value).success && z.safeParse(KNOWN_ENVELOPE, value).success;
}

/** The rollout record `value`, or `undefined` when it is not a record. */
export function codexRecord(value: unknown): CodexRecordValue | undefined {
  return z.safeParse(CodexRecord, value).data;
}

/** The payload of a rollout record, or `undefined` when it is not a record. */
export function codexPayload(value: unknown): CodexPayloadValue | undefined {
  return z.safeParse(CodexPayload, value).data;
}

/** The token counts of a usage object, or `undefined` when it is not a record. */
export function codexTokenCounts(value: unknown): CodexTokenCountsValue | undefined {
  return z.safeParse(CodexTokenCounts, value).data;
}
