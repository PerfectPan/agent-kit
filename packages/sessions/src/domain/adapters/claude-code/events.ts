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
} from "../../transcript/index.js";
import type { Usage } from "../../usage/index.js";
import { asNumber, asRecord, asString } from "../../protocols/record-fields.js";
import type { ClaudeCodeAgentMeta } from "./layout.js";
import { applySnapshots, promptSnapshotPayload, snapshotCapabilities } from "./prompt-snapshot.js";
import { claudeCodeRequestKey, claudeCodeRequestUsage, claudeCodeUsage, knownClaudeCodeGeneration } from "./usage.js";
import { isPromptFlags, recordText, userFlags } from "./user-flags.js";

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
    const rec = asRecord(record.value);
    if (!rec || !knownClaudeCodeGeneration(rec)) {
      return err(unknownFormatGeneration(AGENT, record));
    }
    const type = asString(rec.type) ?? "unknown";
    const uuid = asString(rec.uuid);
    if (startedAt === undefined || ts < startedAt) {
      startedAt = ts;
    }
    if (endedAt === undefined || ts > endedAt) {
      endedAt = ts;
    }
    sessionId ||= asString(rec.sessionId);
    cwd ||= asString(rec.cwd);
    if (!agentVersion && typeof rec.version === "string") {
      agentVersion = rec.version;
    }
    let agentId = asString(rec.agentId) ?? options.agentForFile?.(record.file);
    if (rec.isSidechain === true) {
      agentId ??= "sidechain";
    }
    const parentId = asString(rec.parentUuid);
    if (uuid) {
      parentOf.set(uuid, parentId);
    }

    const emit = (kind: TranscriptEventKind, payload: Record<string, unknown>, part: number, requestId?: string) => {
      events.push(
        baseEvent(record, kind, payload, { id: eventId(uuid, record, part), ts, agentId, parentId, requestId })
      );
    };

    if (type === "user" || type === "assistant") {
      const message = asRecord(rec.message) ?? {};
      const requestId = claudeCodeRequestKey(rec, message);
      if (requestId) {
        mergeRequest(requests, events, record, ts, agentId, requestId, message);
      }
      const flags = type === "user" ? userFlags(rec, message.content) : {};
      const content = message.content;
      if (type === "user" && !agentId && isPromptFlags(flags)) {
        rememberTitle(recordText(content));
      }
      if (typeof content === "string") {
        emit(type, { ...flags, ...(content ? { text: content } : {}) }, 0, requestId);
      } else if (!Array.isArray(content) || content.length === 0) {
        emit(type, flags, 0, requestId);
      } else {
        content.forEach((block, part) => {
          const [kind, payload] = blockEvent(type, flags, asRecord(block));
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
      const attachment = asRecord(rec.attachment);
      const attachmentType = asString(attachment?.type) ?? "";
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
      rememberTitle(asString(rec.customTitle), true);
      skipRecord(skipped, record, "custom-title");
    } else if (type === "ai-title" || type === "summary") {
      rememberTitle(asString(rec.aiTitle) ?? asString(rec.summary) ?? asString(rec.title));
      skipRecord(skipped, record, type);
    } else if (BOOKKEEPING.has(type)) {
      skipRecord(skipped, record, type);
    } else {
      emit("unknown", { type }, 0);
    }
  }

  resolveParents(events, parentOf);
  shadowRemoved(events);
  markOrphanToolResults(events);
  assignSeq(events);

  const agents = agentLanes(events, options.agentMeta);
  const session: TranscriptSession = {
    id: sessionId ?? "unknown",
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
  record: SourcedRecord,
  ts: number,
  agentId: string | undefined,
  requestId: string,
  message: Record<string, unknown>
): void {
  let event = requests.get(requestId);
  if (!event) {
    event = baseEvent(record, "request", {}, { id: `request:${requestId}`, ts, agentId, requestId });
    requests.set(requestId, event);
    events.push(event);
  }
  const usage = claudeCodeRequestUsage(event.payload.usage as Usage | undefined, claudeCodeUsage(message.usage));
  if (usage) {
    event.payload.usage = usage;
  }
  const model = asString(message.model);
  if (model) {
    event.payload.model = model;
  }
  const responseId = asString(message.id);
  if (responseId) {
    event.payload.responseId = responseId;
  }
  const finishReason = asString(message.stop_reason);
  if (finishReason) {
    event.payload.finishReason = finishReason;
  }
}

function blockEvent(
  role: "user" | "assistant",
  flags: Record<string, unknown>,
  item: Record<string, unknown> | undefined
): [TranscriptEventKind, Record<string, unknown>] {
  const blockType = asString(item?.type);
  if (!item || !blockType) {
    return ["unknown", { type: "block" }];
  }
  switch (blockType) {
    case "text": {
      const text = asString(item.text) ?? "";
      return [role, { ...flags, ...(text ? { text } : {}) }];
    }
    case "image": {
      const mediaType = asString(asRecord(item.source)?.media_type);
      return [role, { ...flags, image: true, ...(mediaType ? { mediaType } : {}) }];
    }
    case "fallback": {
      // The response switched models mid-stream (`from.model` → `to.model`).
      const from = asString(asRecord(item.from)?.model);
      const to = asString(asRecord(item.to)?.model);
      return ["system", { type: "fallback", ...(from ? { fromModel: from } : {}), ...(to ? { toModel: to } : {}) }];
    }
    case "thinking":
    case "redacted_thinking": {
      const text = asString(item.thinking);
      return ["reasoning", text ? { text } : { redacted: true }];
    }
    case "tool_use":
      return [
        "tool_call",
        {
          callId: asString(item.id) ?? "",
          name: asString(item.name) ?? "",
          ...(item.input === undefined ? {} : { args: item.input })
        }
      ];
    case "tool_result":
      return [
        "tool_result",
        {
          callId: asString(item.tool_use_id) ?? "",
          ...(item.content === undefined ? {} : { output: item.content }),
          ...(typeof item.is_error === "boolean" ? { isError: item.is_error } : {})
        }
      ];
    default:
      return ["unknown", { type: blockType }];
  }
}

function systemEvent(rec: Record<string, unknown>): [TranscriptEventKind, Record<string, unknown>] {
  const subtype = asString(rec.subtype) ?? "system";
  if (subtype === "compact_boundary") {
    const meta = asRecord(rec.compactMetadata);
    const trigger = asString(meta?.trigger);
    const preTokens = asNumber(meta?.preTokens);
    const postTokens = asNumber(meta?.postTokens);
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
    const durationMs = asNumber(rec.durationMs);
    return ["system", { type: "turn_duration", ...(durationMs === undefined ? {} : { durationMs }) }];
  }
  if (subtype.includes("hook")) {
    return ["hook", { type: subtype }];
  }
  const text = asString(rec.content);
  const payload: Record<string, unknown> = { type: subtype, ...(text ? { text } : {}) };
  // `model_refusal_fallback` / `model_refusal_no_fallback`: the API refused and the CLI retried on another model, or did not.
  for (const key of ["originalModel", "fallbackModel", "apiRefusalCategory"] as const) {
    const value = asString(rec[key]);
    if (value) {
      payload[key] = value;
    }
  }
  return ["system", payload];
}

function hookPayload(type: string, attachment: Record<string, unknown> | undefined): Record<string, unknown> {
  const name = asString(attachment?.hookName);
  const event = asString(attachment?.hookEvent);
  const exitCode = asNumber(attachment?.exitCode);
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
function preservedUuids(events: readonly TranscriptEvent[], compaction: TranscriptEvent): Set<string> | undefined {
  const segment = asRecord(asRecord(asRecord(compaction.original)?.compactMetadata)?.preservedSegment);
  const head = asString(segment?.headUuid);
  const tail = asString(segment?.tailUuid);
  if (!head || !tail) {
    return undefined;
  }
  const keep = new Set<string>();
  let started = false;
  for (const event of events) {
    if (event === compaction) {
      break;
    }
    const uuid = asString(asRecord(event.original)?.uuid);
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

function shadowRemoved(events: readonly TranscriptEvent[]): void {
  for (const compaction of events) {
    if (compaction.kind !== "compaction") {
      continue;
    }
    const keep = preservedUuids(events, compaction);
    // A prompt snapshot is not conversation: a compaction does not remove it.
    shadowBefore(events, compaction, (event) => {
      if (promptSnapshot(event)) {
        return true;
      }
      const uuid = asString(asRecord(event.original)?.uuid);
      return keep !== undefined && uuid !== undefined && keep.has(uuid);
    });
  }
}

/**
 * One lane per agent id. The spawning tool call comes from the meta file's `toolUseId`, else from the tool result
 * whose `toolUseResult.agentId` names the agent; a lane with neither has no `spawnEventId`.
 */
function agentLanes(events: readonly TranscriptEvent[], metas?: ReadonlyMap<string, ClaudeCodeAgentMeta>): Lane[] {
  const calls = new Map<string, TranscriptEvent>();
  const spawnCall = new Map<string, string>();
  for (const event of events) {
    const callId = asString(event.payload.callId);
    if (event.kind === "tool_call" && callId) {
      calls.set(callId, event);
    }
    const spawned = asString(asRecord(asRecord(event.original)?.toolUseResult)?.agentId);
    if (event.kind === "tool_result" && callId && spawned && !spawnCall.has(spawned)) {
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
