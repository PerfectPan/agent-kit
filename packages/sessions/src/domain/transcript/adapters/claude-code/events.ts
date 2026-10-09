import { err, ok, type Result } from "@rivus/agent-kit-catalog";

import {
  assignSeq,
  baseEvent,
  type Capability,
  type Lane,
  lineId,
  MAIN_LANE_ID,
  markOrphanToolResults,
  type ParsedTranscript,
  promptSnapshot,
  shadowBefore,
  type SkippedRecord,
  skipRecord,
  type SourcedRecord,
  type StampedRecord,
  type TranscriptEvent,
  type TranscriptEventKind,
  type TranscriptSession,
  type UnknownFormatGeneration,
  unknownFormatGeneration
} from "../../index.js";
import type { Usage } from "../../../usage/index.js";
import {
  type ClaudeCodeAttachment,
  type ClaudeCodeContentBlockValue,
  type ClaudeCodeRecordValue,
  parseClaudeCodeRecord
} from "./record.js";
import { type ClaudeCodeAgentMeta, claudeCodeSessionStem } from "../../../session/adapters/claude-code/layout.js";
import { applySnapshots, promptSnapshotPayload, snapshotCapabilities } from "./prompt-snapshot.js";
import {
  claudeCodeRequestKey,
  claudeCodeRequestUsage,
  claudeCodeUsageOf
} from "../../../usage/adapters/claude-code.js";
import { type ClaudeCodeUserFlags, isPromptFlags, recordText, userFlags } from "./user-flags.js";

const AGENT = "claude-code";

/** Recorded by every Claude Code session. */
const BASE_CAPABILITIES: readonly Capability[] = [
  "requests",
  "usage",
  "durations",
  "reasoning",
  "compaction",
  "compactionTokens",
  "subagents",
  "hooks"
];

/**
 * Everything a Claude Code transcript can list. `systemPrompt` and `toolSchemas` come from `prompt_snapshot`
 * attachments (2.1.268 and later), so a transcript lists them only when its files contain such a snapshot.
 */
export const CLAUDE_CODE_CAPABILITIES: readonly Capability[] = [...BASE_CAPABILITIES, "systemPrompt", "toolSchemas"];

/** The capabilities one translated transcript shows. */
export function claudeCodeCapabilities(events: readonly TranscriptEvent[]): Capability[] {
  return [...BASE_CAPABILITIES, ...snapshotCapabilities(events)];
}

/** Record types that only the CLI reads. Each becomes a skipped record with its type as the reason. */
const BOOKKEEPING = new Set([
  "file-history-snapshot",
  "file-history-delta",
  "cost-state",
  "last-prompt",
  "atis-latch",
  "mode",
  "permission-mode",
  "queue-operation",
  "relocated",
  "worktree-state",
  "fork-context-ref",
  "pr-link",
  "frame-link"
]);

export interface ClaudeCodeTranslateOptions {
  /** Wins over the `sessionId` the records carry. */
  sessionId?: string;
  /**
   * The session file's path, whose name is the session's fallback id when neither this option nor the records name
   * one.
   */
  path?: string;
  /** The lane of records from a subagent file whose records carry no `agentId`. */
  agentForFile?: (file: string) => string | undefined;
  agentMeta?: ReadonlyMap<string, ClaudeCodeAgentMeta>;
}

/**
 * Translates Claude Code records, already merged across the session's files in time order (`mergeByTime`), into
 * transcript events. Event ids are record `uuid`s, with `:<part>` for the later content blocks of one record.
 */
export function translateClaudeCodeRecords(
  stamped: readonly StampedRecord[],
  options: ClaudeCodeTranslateOptions = {}
): Result<ParsedTranscript, UnknownFormatGeneration> {
  const events: TranscriptEvent[] = [];
  const skipped: SkippedRecord[] = [];
  const requests = new Map<string, TranscriptEvent>();
  const parentOf = new Map<string, string | undefined>();
  /** Each event's parsed record, so the later passes never parse a record again. */
  const parsed = new Map<TranscriptEvent, ClaudeCodeRecordValue>();
  let sessionId = options.sessionId;
  let title: string | undefined;
  let titleExplicit = false;
  let cwd: string | undefined;
  let agentVersion: string | undefined;
  let startedAt: number | undefined;
  let endedAt: number | undefined;

  const rememberTitle = (text: string | undefined, explicit = false): void => {
    if (!text) {
      return;
    }
    if (explicit) {
      title = text;
      titleExplicit = true;
    } else if (!titleExplicit && !title) {
      title = text.slice(0, 80);
    }
  };

  for (const { record, ts } of stamped) {
    const rec = parseClaudeCodeRecord(record.value);
    if (!rec) {
      return err(unknownFormatGeneration(AGENT, record));
    }
    const type = rec.type;
    const uuid = rec.uuid;
    if (startedAt === undefined || ts < startedAt) {
      startedAt = ts;
    }
    if (endedAt === undefined || ts > endedAt) {
      endedAt = ts;
    }
    sessionId ||= rec.sessionId;
    cwd ||= rec.cwd;
    if (!agentVersion && typeof rec.version === "string") {
      agentVersion = rec.version;
    }
    let agentId = rec.agentId ?? options.agentForFile?.(record.file);
    if (rec.isSidechain) {
      agentId ??= "sidechain";
    }
    const parentId = rec.parentUuid;
    if (uuid) {
      parentOf.set(uuid, parentId);
    }

    const emit = (kind: TranscriptEventKind, payload: Record<string, unknown>, part: number, requestId?: string) => {
      const event = baseEvent(record, kind, payload, {
        id: eventId(uuid, record, part),
        ts,
        agentId,
        parentId,
        requestId
      });
      events.push(event);
      parsed.set(event, rec);
    };

    if (type === "user" || type === "assistant") {
      const requestId = claudeCodeRequestKey(rec);
      if (requestId) {
        mergeRequest(requests, events, parsed, rec, record, ts, agentId, requestId);
      }
      const message = rec.message;
      const flags: ClaudeCodeUserFlags = type === "user" ? userFlags(rec) : {};
      const content = message?.content;
      if (type === "user" && !agentId && isPromptFlags(flags)) {
        rememberTitle(recordText(rec));
      }
      if (typeof content === "string") {
        emit(type, { ...flags, ...(content ? { text: content } : {}) }, 0, requestId);
      } else if (!Array.isArray(content) || content.length === 0) {
        emit(type, { ...flags }, 0, requestId);
      } else {
        content.forEach((block, part) => {
          const [kind, payload] = blockEvent(type, flags, block);
          emit(kind, payload, part, requestId);
        });
      }
      continue;
    }

    if (type === "system") {
      const [kind, payload] = systemEvent(rec);
      emit(kind, payload, 0);
      continue;
    }

    if (type === "attachment") {
      const attachment = rec.attachment;
      const attachmentType = attachment?.type ?? "";
      if (attachment && attachmentType === "prompt_snapshot") {
        const payload = promptSnapshotPayload(attachment);
        if (!payload) {
          return err(unknownFormatGeneration(AGENT, record));
        }
        emit("system", payload, 0);
      } else if (attachmentType.startsWith("hook_")) {
        emit("hook", hookPayload(attachmentType, attachment), 0);
      } else {
        skipRecord(skipped, record, `attachment:${attachmentType || "record"}`);
      }
      continue;
    }

    if (type === "custom-title") {
      rememberTitle(rec.customTitle, true);
      skipRecord(skipped, record, "custom-title");
    } else if (type === "ai-title" || type === "summary") {
      rememberTitle(rec.aiTitle ?? rec.summary ?? rec.title);
      skipRecord(skipped, record, type);
    } else if (BOOKKEEPING.has(type)) {
      skipRecord(skipped, record, type);
    } else {
      emit("unknown", { type }, 0);
    }
  }

  resolveParents(events, parentOf);
  shadowRemoved(events, parsed);
  markOrphanToolResults(events);
  assignSeq(events);

  const agents = agentLanes(events, options.agentMeta, parsed);
  const fallbackId = options.path === undefined ? undefined : claudeCodeSessionStem(options.path) || "unknown";
  const session: TranscriptSession = {
    id: sessionId ?? fallbackId ?? "unknown",
    ...(title ? { title } : {}),
    ...(cwd ? { cwd } : {}),
    ...(startedAt === undefined ? {} : { startedAt }),
    ...(endedAt === undefined ? {} : { endedAt })
  };
  applySnapshots(events, agents, session);
  return ok({ events, skipped, session, agents, ...(agentVersion ? { agentVersion } : {}) });
}

function eventId(uuid: string | undefined, record: SourcedRecord, part: number): string {
  if (!uuid) {
    return lineId(record, part);
  }
  return part === 0 ? uuid : `${uuid}:${part}`;
}

/**
 * One `request` event per request key (`claudeCodeRequestKey`), at its first record: Claude Code writes one record per
 * content block, and a request's records may interleave with another's. Later records update its model and finish
 * reason, and its usage by `claudeCodeRequestUsage`.
 */
function mergeRequest(
  requests: Map<string, TranscriptEvent>,
  events: TranscriptEvent[],
  parsed: Map<TranscriptEvent, ClaudeCodeRecordValue>,
  rec: ClaudeCodeRecordValue,
  record: SourcedRecord,
  ts: number,
  agentId: string | undefined,
  requestId: string
): void {
  let event = requests.get(requestId);
  if (!event) {
    event = baseEvent(record, "request", {}, { id: `request:${requestId}`, ts, agentId, requestId });
    requests.set(requestId, event);
    events.push(event);
    parsed.set(event, rec);
  }
  const message = rec.message;
  const usage = claudeCodeRequestUsage(event.payload.usage as Usage | undefined, claudeCodeUsageOf(message?.usage));
  if (usage) {
    event.payload.usage = usage;
  }
  const model = message?.model;
  if (model) {
    event.payload.model = model;
  }
  const responseId = message?.id;
  if (responseId) {
    event.payload.responseId = responseId;
  }
  const finishReason = message?.stop_reason;
  if (finishReason) {
    event.payload.finishReason = finishReason;
  }
}

function blockEvent(
  role: "user" | "assistant",
  flags: ClaudeCodeUserFlags,
  item: ClaudeCodeContentBlockValue | undefined
): [TranscriptEventKind, Record<string, unknown>] {
  const blockType = item?.type;
  if (!item || !blockType) {
    return ["unknown", { type: "block" }];
  }
  switch (blockType) {
    case "text": {
      const text = item.text ?? "";
      return [role, { ...flags, ...(text ? { text } : {}) }];
    }
    case "image": {
      const mediaType = item.source?.media_type;
      return [role, { ...flags, image: true, ...(mediaType ? { mediaType } : {}) }];
    }
    case "fallback": {
      // The response switched models mid-stream (`from.model` → `to.model`).
      const from = item.from?.model;
      const to = item.to?.model;
      return ["system", { type: "fallback", ...(from ? { fromModel: from } : {}), ...(to ? { toModel: to } : {}) }];
    }
    case "thinking":
    case "redacted_thinking": {
      const text = item.thinking;
      return ["reasoning", text ? { text } : { redacted: true }];
    }
    case "tool_use":
      return [
        "tool_call",
        {
          callId: item.id ?? "",
          name: item.name ?? "",
          ...(item.input === undefined ? {} : { args: item.input })
        }
      ];
    case "tool_result":
      return [
        "tool_result",
        {
          callId: item.tool_use_id ?? "",
          ...(item.content === undefined ? {} : { output: item.content }),
          ...(item.is_error === undefined ? {} : { isError: item.is_error })
        }
      ];
    default:
      return ["unknown", { type: blockType }];
  }
}

function systemEvent(rec: ClaudeCodeRecordValue): [TranscriptEventKind, Record<string, unknown>] {
  const subtype = rec.subtype ?? "system";
  if (subtype === "compact_boundary") {
    const trigger = rec.compactMetadata?.trigger;
    const preTokens = rec.compactMetadata?.preTokens;
    const postTokens = rec.compactMetadata?.postTokens;
    return [
      "compaction",
      {
        ...(trigger === "auto" || trigger === "manual" ? { trigger } : {}),
        ...(preTokens === undefined ? {} : { preTokens }),
        ...(postTokens === undefined ? {} : { postTokens })
      }
    ];
  }
  if (subtype === "turn_duration") {
    const durationMs = rec.durationMs;
    return ["system", { type: "turn_duration", ...(durationMs === undefined ? {} : { durationMs }) }];
  }
  if (subtype.includes("hook")) {
    return ["hook", { type: subtype }];
  }
  const text = rec.content;
  const payload: Record<string, unknown> = { type: subtype, ...(text ? { text } : {}) };
  // `model_refusal_fallback` / `model_refusal_no_fallback`: the API refused and the CLI retried on another model, or did not.
  for (const key of ["originalModel", "fallbackModel", "apiRefusalCategory"] as const) {
    const value = rec[key];
    if (value) {
      payload[key] = value;
    }
  }
  return ["system", payload];
}

function hookPayload(type: string, attachment: ClaudeCodeAttachment | undefined): Record<string, unknown> {
  const name = attachment?.hookName;
  const event = attachment?.hookEvent;
  const exitCode = attachment?.exitCode;
  return {
    type,
    ...(name ? { name } : {}),
    ...(event ? { event } : {}),
    ...(exitCode === undefined ? {} : { exitCode })
  };
}

/**
 * Points `parentId` at an event. A record's `parentUuid` can name a record that became no event (a skipped
 * attachment, say); the event then takes the nearest ancestor that is an event, or no parent.
 */
function resolveParents(events: readonly TranscriptEvent[], parentOf: ReadonlyMap<string, string | undefined>): void {
  const ids = new Set(events.map((event) => event.id));
  for (const event of events) {
    let parent = event.parentId;
    const seen = new Set<string>();
    while (parent !== undefined && !ids.has(parent) && !seen.has(parent)) {
      seen.add(parent);
      parent = parentOf.get(parent);
    }
    if (parent === undefined || !ids.has(parent)) {
      delete event.parentId;
    } else {
      event.parentId = parent;
    }
  }
}

/** Record uuids from `compactMetadata.preservedSegment.headUuid` to `tailUuid`, which the compaction kept. */
function preservedUuids(
  events: readonly TranscriptEvent[],
  compaction: TranscriptEvent,
  parsed: ReadonlyMap<TranscriptEvent, ClaudeCodeRecordValue>
): Set<string> | undefined {
  const segment = parsed.get(compaction)?.compactMetadata?.preservedSegment;
  const head = segment?.headUuid;
  const tail = segment?.tailUuid;
  if (!head || !tail) {
    return undefined;
  }
  const keep = new Set<string>();
  let started = false;
  for (const event of events) {
    if (event === compaction) {
      break;
    }
    const uuid = parsed.get(event)?.uuid;
    if (!uuid) {
      continue;
    }
    started ||= uuid === head;
    if (started) {
      keep.add(uuid);
      if (uuid === tail) {
        break;
      }
    }
  }
  return keep;
}

function shadowRemoved(
  events: readonly TranscriptEvent[],
  parsed: ReadonlyMap<TranscriptEvent, ClaudeCodeRecordValue>
): void {
  for (const compaction of events) {
    if (compaction.kind !== "compaction") {
      continue;
    }
    const keep = preservedUuids(events, compaction, parsed);
    // A prompt snapshot is not conversation: a compaction does not remove it.
    shadowBefore(events, compaction, (event) => {
      if (promptSnapshot(event)) {
        return true;
      }
      const uuid = parsed.get(event)?.uuid;
      return keep !== undefined && uuid !== undefined && keep.has(uuid);
    });
  }
}

/**
 * One lane per agent id. The spawning tool call comes from the meta file's `toolUseId`, else from the tool result
 * whose `toolUseResult.agentId` names the agent; a lane with neither has no `spawnEventId`.
 */
function agentLanes(
  events: readonly TranscriptEvent[],
  metas: ReadonlyMap<string, ClaudeCodeAgentMeta> | undefined,
  parsed: ReadonlyMap<TranscriptEvent, ClaudeCodeRecordValue>
): Lane[] {
  const calls = new Map<string, TranscriptEvent>();
  const spawnCall = new Map<string, string>();
  for (const event of events) {
    // `callId` is this translation's own payload field, a string for every tool call and result it emits.
    const callId = event.payload.callId;
    if (event.kind === "tool_call" && typeof callId === "string" && callId) {
      calls.set(callId, event);
    }
    const spawned = parsed.get(event)?.toolUseResult?.agentId;
    if (event.kind === "tool_result" && typeof callId === "string" && callId && spawned && !spawnCall.has(spawned)) {
      spawnCall.set(spawned, callId);
    }
  }
  const agents: Lane[] = [{ id: MAIN_LANE_ID }];
  const seen = new Set<string>([MAIN_LANE_ID]);
  for (const event of events) {
    const id = event.agentId;
    if (!id || seen.has(id)) {
      continue;
    }
    seen.add(id);
    const meta = metas?.get(id);
    const spawn = calls.get(meta?.toolUseId ?? spawnCall.get(id) ?? "");
    const agent: Lane = { id, parentId: meta?.parentAgentId ?? spawn?.agentId ?? MAIN_LANE_ID };
    if (spawn) {
      agent.spawnEventId = spawn.id;
    }
    if (meta?.title) {
      agent.title = meta.title;
    }
    agents.push(agent);
  }
  return agents;
}
