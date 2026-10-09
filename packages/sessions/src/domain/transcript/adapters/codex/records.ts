import * as z from "zod/mini";

import { lenient } from "../lenient.js";
import { logTimestamp } from "../timestamp.js";

// Codex writes one rollout record per line. Agent logs are read leniently: a field of an unexpected type counts as
// absent (./lenient.js), and only the record envelope decides whether the format generation is known.

/**
 * A field named on one side of a schema/interface pair only — an interface typo, or a schema field the interface
 * misses — fails to compile with this: the schema's keys and the value type's keys must be the same.
 */
export type KeysExact<Schema extends object, Value> =
  | Exclude<keyof Schema, keyof Value>
  | Exclude<keyof Value, keyof Schema> extends never
  ? true
  : never;

/** A usage object as both `token_usage_record.usage` and `token_count.info` carry it. */
interface CodexTokenCounts {
  input_tokens?: number;
  cached_input_tokens?: number;
  cache_write_input_tokens?: number;
  output_tokens?: number;
  reasoning_output_tokens?: number;
  total_tokens?: number;
}

const CodexTokenCountsSchema = z.looseObject({
  input_tokens: lenient(z.number()),
  cached_input_tokens: lenient(z.number()),
  cache_write_input_tokens: lenient(z.number()),
  output_tokens: lenient(z.number()),
  reasoning_output_tokens: lenient(z.number()),
  total_tokens: lenient(z.number())
});

/** A history item of a `replacement_history`: the fields matching keeps, `content` kept raw for the text. */
interface CodexHistoryItem {
  type?: string;
  role?: string;
  id?: string;
  call_id?: string;
  content?: unknown;
}

const CodexHistoryItemSchema = z.looseObject({
  type: lenient(z.string()),
  role: lenient(z.string()),
  id: lenient(z.string()),
  call_id: lenient(z.string()),
  content: z.optional(z.unknown())
});

/**
 * The payload of a rollout record, whatever envelope carries it: the `session_meta` identity, the `turn_context`
 * model, the `event_msg` markers, the usage objects, and the fields of a response item or of a bare item of an older
 * rollout. Fields a reader does not name stay in the payload; the parsed value carries them beside these fields.
 */
interface CodexPayload {
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
  };
  base_instructions?: { text?: string };
  thread_settings?: { service_tier?: string };
  source?: { subagent?: { thread_spawn?: unknown } };
  usage?: Record<string, unknown>;
  /** A payload's own time, as a `session_meta` or a pre-envelope item carries it. */
  timestamp?: number | string;
  info?: {
    total_token_usage?: unknown;
    last_token_usage?: unknown;
  };
  replacement_history?: (CodexHistoryItemValue | undefined)[];
}

const CodexPayloadSchema = z.looseObject({
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
  timestamp: logTimestamp,
  // The totals stay the raw values they were: the usage rule compares them by their JSON text, so a parsed copy
  // would normalize `null`, a mistyped total, or a `__proto__` key into something else.
  info: lenient(
    z.looseObject({
      total_token_usage: z.optional(z.unknown()),
      last_token_usage: z.optional(z.unknown())
    })
  ),
  replacement_history: lenient(z.array(lenient(CodexHistoryItemSchema)))
});

/**
 * One rollout record: the envelope `type`, the `record_type` bookkeeping marker, the header `id` of a pre-envelope
 * rollout, and the presence markers the generation check reads. `payload` stays raw because only the record knows
 * whether it is a bare item's record, whose fields sit on the record itself; readers parse it through `codexPayload`.
 */
interface CodexRecord {
  type?: string;
  record_type?: string;
  id?: string;
  timestamp?: number | string;
  formatVersion?: unknown;
  payload?: unknown;
}

// The envelope type is a non-empty string: the old readers treated an empty envelope like an absent one.
const NonEmptyString = z.string().check(z.minLength(1));

/**
 * The envelope every codex reader parses: the non-empty `type`, the `record_type` bookkeeping marker, the header `id`
 * of a pre-envelope rollout with the `timestamp` it carries, and the `formatVersion` marker the generation check
 * reads. Key presence decides the check, and a lenient field keeps its key when the value is mistyped, so a
 * `timestamp` of another type still names a header. Readers that parse their own payload spread `.shape` and add a
 * `payload` field of theirs.
 */
export const CodexEnvelopeSchema: z.ZodMiniObject<
  {
    type: z.ZodMiniCatch<z.ZodMiniOptional<z.ZodMiniString>>;
    record_type: z.ZodMiniCatch<z.ZodMiniOptional<z.ZodMiniString>>;
    id: z.ZodMiniCatch<z.ZodMiniOptional<z.ZodMiniString>>;
    timestamp: z.ZodMiniCatch<z.ZodMiniOptional<z.ZodMiniUnion<[z.ZodMiniString, z.ZodMiniNumber]>>>;
    formatVersion: z.ZodMiniOptional<z.ZodMiniUnknown>;
  },
  z.core.$loose
> = z.looseObject({
  type: lenient(NonEmptyString),
  record_type: lenient(NonEmptyString),
  id: lenient(z.string()),
  timestamp: logTimestamp,
  formatVersion: z.optional(z.unknown())
});

const CodexRecordSchema = z.looseObject({ ...CodexEnvelopeSchema.shape, payload: z.optional(z.unknown()) });

/**
 * A record of a format generation this adapter reads: no `formatVersion`, and a non-empty `type`, a `record_type`
 * bookkeeping marker, or the `timestamp` and `id` of an older rollout's header — by key presence, whatever the
 * values are. The parse keeps a key whose value a field schema rejects, so `Object.hasOwn` on the parsed record is
 * the old `"key" in record` check and the envelope parse is also the generation check.
 */
export function knownCodexRecord(rec: CodexRecordValue | undefined): rec is CodexRecordValue {
  if (rec === undefined || Object.hasOwn(rec, "formatVersion")) {
    return false;
  }
  return (
    rec.type !== undefined ||
    rec.record_type !== undefined ||
    (Object.hasOwn(rec, "id") && Object.hasOwn(rec, "timestamp"))
  );
}

/** The parsed values carry the fields the schema passes through that the interfaces do not name. */
export type CodexRecordValue = CodexRecord & Record<string, unknown>;
export type CodexPayloadValue = CodexPayload & Record<string, unknown>;
type CodexTokenCountsValue = CodexTokenCounts & Record<string, unknown>;
export type CodexHistoryItemValue = CodexHistoryItem & Record<string, unknown>;

const _codexRecordKeys: true = true satisfies KeysExact<typeof CodexRecordSchema.shape, CodexRecord>;
const _codexPayloadKeys: true = true satisfies KeysExact<typeof CodexPayloadSchema.shape, CodexPayload>;
const _codexHistoryItemKeys: true = true satisfies KeysExact<typeof CodexHistoryItemSchema.shape, CodexHistoryItem>;
const _codexTokenCountsKeys: true = true satisfies KeysExact<typeof CodexTokenCountsSchema.shape, CodexTokenCounts>;

// Compiled: every schema names exactly the keys of its interface, in both directions. The checks stay exported so
// they are never unused, and typeof a `true satisfies` check is just `true`, which drags no schema type into the
// declaration file.
export type CodexKeysExact = [
  typeof _codexRecordKeys,
  typeof _codexPayloadKeys,
  typeof _codexHistoryItemKeys,
  typeof _codexTokenCountsKeys
];

/** The rollout record `value`, or `undefined` when it is not a record. */
export function codexRecord(value: unknown): CodexRecordValue | undefined {
  return z.safeParse(CodexRecordSchema, value).data;
}

/** The payload of a rollout record, or `undefined` when it is not a record. */
export function codexPayload(value: unknown): CodexPayloadValue | undefined {
  return z.safeParse(CodexPayloadSchema, value).data;
}

/** The token counts of a usage object, or `undefined` when it is not a record. */
export function codexTokenCounts(value: unknown): CodexTokenCountsValue | undefined {
  return z.safeParse(CodexTokenCountsSchema, value).data;
}
