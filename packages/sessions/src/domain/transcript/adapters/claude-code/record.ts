import * as z from "zod/mini";

import { lenient } from "../lenient.js";

/**
 * The `usage` of an assistant message. Claude Code reports `input_tokens` without the cache, and may carry the
 * cache write count flat or as the `cache_creation` breakdown by TTL.
 */
export interface ClaudeCodeMessageUsageValue {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_creation?: { ephemeral_5m_input_tokens?: number; ephemeral_1h_input_tokens?: number };
  output_tokens_details?: { thinking_tokens?: number };
}

/**
 * One content block of a message. A block the schema rejects stays in place as absent, so the block's part
 * number and the `unknown` event it becomes keep their position in the record.
 */
export interface ClaudeCodeContentBlockValue {
  type?: string;
  text?: string;
  thinking?: string;
  id?: string;
  name?: string;
  input?: unknown;
  tool_use_id?: string;
  content?: unknown;
  is_error?: boolean;
  source?: { media_type?: string };
  from?: { model?: string };
  to?: { model?: string };
}

/** The `message` of a `user` or `assistant` record. */
export interface ClaudeCodeMessageValue {
  id?: string;
  model?: string;
  stop_reason?: string;
  usage?: ClaudeCodeMessageUsageValue;
  content?: string | (ClaudeCodeContentBlockValue | undefined)[];
}

/** The `attachment` of a record, as the translator and the hook and snapshot rules read it. */
export interface ClaudeCodeAttachment {
  type?: string;
  hookName?: string;
  hookEvent?: string;
  exitCode?: number;
}

/**
 * A Claude Code log record whose envelope the kit knows, as `parseClaudeCodeRecord` returns it. The schemas below
 * produce these shapes; the parse functions' return types hold the two in line.
 */
export interface ClaudeCodeRecordValue {
  type: string;
  uuid?: string;
  parentUuid?: string;
  sessionId?: string;
  cwd?: string;
  /**
   * Any value the envelope accepts: everything but a number and a string without a leading semver, so a
   * non-JSON caller may hand over a `Date` or a `Map` and the record stays known.
   */
  version?: unknown;
  /** A record that carries the key in any form, even `undefined`, is a format this kit does not know. */
  formatVersion?: undefined;
  agentId?: string;
  requestId?: string;
  timestamp?: number | string;
  /** Only the exact `true` flags a user record as not a prompt or as a sidechain lane. */
  isSidechain?: true;
  isMeta?: true;
  isCompactSummary?: true;
  origin?: { kind?: string };
  customTitle?: string;
  aiTitle?: string;
  summary?: string;
  title?: string;
  subtype?: string;
  content?: string;
  durationMs?: number;
  originalModel?: string;
  fallbackModel?: string;
  apiRefusalCategory?: string;
  compactMetadata?: {
    trigger?: string;
    preTokens?: number;
    postTokens?: number;
    /** The uuid range a compaction kept; `shadowRemoved` reads it off the record parsed beside the event. */
    preservedSegment?: { headUuid?: string; tailUuid?: string };
  };
  /** A spawning tool result names the agent it started; `agentLanes` reads it off the record parsed beside the event. */
  toolUseResult?: { agentId?: string };
  message?: ClaudeCodeMessageValue;
  attachment?: ClaudeCodeAttachment;
}

/** The fields of a record the usage decoder reads; the envelope rules are `ClaudeCodeRecordValue`'s. */
export interface ClaudeCodeUsageRecordValue {
  type: string;
  requestId?: string;
  sessionId?: string;
  agentId?: string;
  isSidechain?: true;
  timestamp?: number | string;
  message?: { id?: string; model?: string; usage?: ClaudeCodeMessageUsageValue };
}

/** The fields of a record the preview reads; it works regardless of the envelope, so even `type` is lenient. */
export interface ClaudeCodePreviewRecordValue {
  type?: string;
  sessionId?: string;
  cwd?: string;
  customTitle?: string;
  aiTitle?: string;
  timestamp?: number | string;
  isSidechain?: true;
  isMeta?: true;
  isCompactSummary?: true;
  origin?: { kind?: string };
  message?: { content?: string | (ClaudeCodeContentBlockValue | undefined)[] };
}

/** The `usage` of an assistant message, as the schema reads it. */
const ClaudeCodeMessageUsage = z.looseObject({
  input_tokens: lenient(z.number()),
  output_tokens: lenient(z.number()),
  cache_read_input_tokens: lenient(z.number()),
  cache_creation_input_tokens: lenient(z.number()),
  cache_creation: lenient(
    z.looseObject({
      ephemeral_5m_input_tokens: lenient(z.number()),
      ephemeral_1h_input_tokens: lenient(z.number())
    })
  ),
  output_tokens_details: lenient(z.looseObject({ thinking_tokens: lenient(z.number()) }))
});

/**
 * The fields of one content block, shared between the block schema and its interface above.
 */
const contentBlock = {
  type: lenient(z.string()),
  text: lenient(z.string()),
  thinking: lenient(z.string()),
  id: lenient(z.string()),
  name: lenient(z.string()),
  input: z.optional(z.unknown()),
  tool_use_id: lenient(z.string()),
  content: z.optional(z.unknown()),
  is_error: lenient(z.boolean()),
  source: lenient(z.looseObject({ media_type: lenient(z.string()) })),
  from: lenient(z.looseObject({ model: lenient(z.string()) })),
  to: lenient(z.looseObject({ model: lenient(z.string()) }))
};

/** The only block fields the preview's prompt rule reads. */
const textBlock = {
  type: lenient(z.string()),
  text: lenient(z.string())
};

/**
 * A `version` a record may carry without ending its format generation: any value that is neither a number nor a
 * string without a leading semver. A `Date`, `Map` or `bigint` version from a non-JSON caller stays known, like
 * the hand-written readers before.
 */
const knownVersion = z.optional(
  z
    .unknown()
    .check(
      z.refine((value) => typeof value !== "number" && !(typeof value === "string" && !/^\d+\.\d+\.\d/.test(value)))
    )
);

/** A record that carries its own envelope generation, in any form, is one this kit does not know. */
function withoutFormatVersion(record: Record<string, unknown>): boolean {
  return !("formatVersion" in record);
}

/**
 * The record envelope this adapter knows: a string `type`, a `version` as `knownVersion` accepts, and no
 * `formatVersion` key. Only the envelope decides whether the format generation is known — a record that fails it
 * is an `UnknownFormatGeneration` for the whole file, whatever its other fields hold.
 */
const ClaudeCodeRecord = z
  .looseObject({
    type: z.string(),
    version: knownVersion,
    uuid: lenient(z.string()),
    parentUuid: lenient(z.string()),
    sessionId: lenient(z.string()),
    cwd: lenient(z.string()),
    agentId: lenient(z.string()),
    requestId: lenient(z.string()),
    timestamp: lenient(z.union([z.number(), z.string()])),
    isSidechain: lenient(z.literal(true)),
    isMeta: lenient(z.literal(true)),
    isCompactSummary: lenient(z.literal(true)),
    origin: lenient(z.looseObject({ kind: lenient(z.string()) })),
    customTitle: lenient(z.string()),
    aiTitle: lenient(z.string()),
    summary: lenient(z.string()),
    title: lenient(z.string()),
    subtype: lenient(z.string()),
    content: lenient(z.string()),
    durationMs: lenient(z.number()),
    originalModel: lenient(z.string()),
    fallbackModel: lenient(z.string()),
    apiRefusalCategory: lenient(z.string()),
    compactMetadata: lenient(
      z.looseObject({
        trigger: lenient(z.string()),
        preTokens: lenient(z.number()),
        postTokens: lenient(z.number()),
        preservedSegment: lenient(z.looseObject({ headUuid: lenient(z.string()), tailUuid: lenient(z.string()) }))
      })
    ),
    toolUseResult: lenient(z.looseObject({ agentId: lenient(z.string()) })),
    message: lenient(
      z.looseObject({
        id: lenient(z.string()),
        model: lenient(z.string()),
        stop_reason: lenient(z.string()),
        usage: lenient(ClaudeCodeMessageUsage),
        content: lenient(z.union([z.string(), z.array(lenient(z.looseObject(contentBlock)))]))
      })
    ),
    attachment: lenient(
      z.looseObject({
        type: lenient(z.string()),
        hookName: lenient(z.string()),
        hookEvent: lenient(z.string()),
        exitCode: lenient(z.number())
      })
    )
  })
  .check(z.refine(withoutFormatVersion));

/**
 * Parses a record for the translator. `undefined` is an unknown format generation: the value is no record, or its
 * envelope is one this adapter does not know.
 */
export function parseClaudeCodeRecord(value: unknown): ClaudeCodeRecordValue | undefined {
  return z.safeParse(ClaudeCodeRecord, value).data;
}

/**
 * The fields of a record the usage decoder reads, under the same envelope as `ClaudeCodeRecord` but without the
 * fields it never opens, so the parse does not copy every content block of every record.
 */
const ClaudeCodeUsageRecord = z
  .looseObject({
    type: z.string(),
    version: knownVersion,
    requestId: lenient(z.string()),
    sessionId: lenient(z.string()),
    agentId: lenient(z.string()),
    isSidechain: lenient(z.literal(true)),
    timestamp: lenient(z.union([z.number(), z.string()])),
    message: lenient(
      z.looseObject({
        id: lenient(z.string()),
        model: lenient(z.string()),
        usage: lenient(ClaudeCodeMessageUsage)
      })
    )
  })
  .check(z.refine(withoutFormatVersion));

/** Parses a record for the usage decoder; `undefined` is an unknown format generation, as above. */
export function parseClaudeCodeUsageRecord(value: unknown): ClaudeCodeUsageRecordValue | undefined {
  return z.safeParse(ClaudeCodeUsageRecord, value).data;
}

/** Parses the `usage` of an assistant message for the usage rules. */
export function parseClaudeCodeMessageUsage(value: unknown): ClaudeCodeMessageUsageValue | undefined {
  return z.safeParse(ClaudeCodeMessageUsage, value).data;
}

/**
 * The fields of a record the preview reads. The preview works regardless of the envelope, so it parses without
 * the envelope rules and reads the head and tail of a file, where a record an unrecognized CLI wrote still names
 * its session, time and title.
 */
const ClaudeCodePreviewRecord = z.looseObject({
  type: lenient(z.string()),
  sessionId: lenient(z.string()),
  cwd: lenient(z.string()),
  customTitle: lenient(z.string()),
  aiTitle: lenient(z.string()),
  timestamp: lenient(z.union([z.number(), z.string()])),
  isSidechain: lenient(z.literal(true)),
  isMeta: lenient(z.literal(true)),
  isCompactSummary: lenient(z.literal(true)),
  origin: lenient(z.looseObject({ kind: lenient(z.string()) })),
  message: lenient(
    z.looseObject({ content: lenient(z.union([z.string(), z.array(lenient(z.looseObject(textBlock)))])) })
  )
});

/** Parses one record for the preview. */
export function parseClaudeCodePreviewRecord(value: Record<string, unknown>): ClaudeCodePreviewRecordValue | undefined {
  return z.safeParse(ClaudeCodePreviewRecord, value).data;
}
