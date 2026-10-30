import { CLAUDE_CODE_ID } from "../facts.js";
import { err, ok, type Result } from "@rivus/agent-kit-catalog/spi";

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
  type TranscriptEventOf,
  type TranscriptSession,
  type UnknownFormatGeneration,
  unknownFormatGeneration
} from "@rivus/agent-kit-sessions/spi";
import { type ClaudeCodeRecordValue, parseClaudeCodeRecord } from "../records/record.js";
import { type ClaudeCodeAgentMeta, claudeCodeSessionStem } from "../layout.js";
import { applySnapshots, snapshotCapabilities } from "./prompt-snapshot.js";
import { claudeCodeRequestUsage, claudeCodeUsageOf } from "../records/usage.js";
import { claudeCodeLaneOf, classifyClaudeCodeRecord } from "./classify.js";

const AGENT = CLAUDE_CODE_ID;

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

function eventId(uuid: string | undefined, record: SourcedRecord, part: number): string {
  if (!uuid) {
    return lineId(record, part);
  }
  return part === 0 ? uuid : `${uuid}:${part}`;
}

/**
 * One `request` event per request key (`claudeCodeRequestKey`), at its first record: Claude Code writes one record per
 * content block, and a request's records may interleave with another's. Later records update its model and finish
 * reason, and its usage by `claudeCodeRequestUsage`. The request keeps `request:<requestId>` only while no emitted
 * event holds that id, else the first free serial of it; records may carry any uuid, so the check at emission — not
 * the `request:` pattern — is what keeps ids unique.
 */
function mergeRequest(
  requests: Map<string, TranscriptEventOf<"request">>,
  events: TranscriptEvent[],
  parsed: Map<TranscriptEvent, ClaudeCodeRecordValue>,
  rec: ClaudeCodeRecordValue,
  record: SourcedRecord,
  ts: number,
  agentId: string | undefined,
  requestId: string,
  usedIds: Set<string>,
  requestIds: Set<string>
): void {
  let event = requests.get(requestId);
  if (!event) {
    let id = `request:${requestId}`;
    if (usedIds.has(id)) {
      let serial = 1;
      while (usedIds.has(`request:${requestId}:${serial}`)) {
        serial += 1;
      }
      id = `request:${requestId}:${serial}`;
    }
    usedIds.add(id);
    requestIds.add(id);
    event = baseEvent(record, "request", {}, { id, ts, agentId, requestId });
    requests.set(requestId, event);
    events.push(event);
    parsed.set(event, rec);
  }
  const message = rec.message;
  const usage = claudeCodeRequestUsage(event.payload.usage, claudeCodeUsageOf(message?.usage));
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
    if (event.kind === "tool_call" && event.payload.callId) {
      calls.set(event.payload.callId, event);
    }
    const spawned = parsed.get(event)?.toolUseResult?.agentId;
    if (event.kind === "tool_result" && event.payload.callId && spawned && !spawnCall.has(spawned)) {
      spawnCall.set(spawned, event.payload.callId);
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
  const requests = new Map<string, TranscriptEventOf<"request">>();
  /** Every id an emitted event holds, so an id one already holds moves to the next free serial. */
  const usedIds = new Set<string>();
  /** The ids request events hold, so a record uuid one holds moves to the record's line id. */
  const requestIds = new Set<string>();
  /** The first id of `base`'s shape no event holds: `base` itself, then `base:1`, `base:2`, … */
  const nextFree = (base: string): string => {
    let candidate = base;
    for (let serial = 1; usedIds.has(candidate); serial += 1) {
      candidate = `${base}:${serial}`;
    }
    return candidate;
  };
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
    const agentId = claudeCodeLaneOf(rec, record.file, options.agentForFile);
    const parentId = rec.parentUuid;
    if (uuid) {
      parentOf.set(uuid, parentId);
    }

    const classified = classifyClaudeCodeRecord(rec);
    if (classified.generationError) {
      return err(unknownFormatGeneration(AGENT, record));
    }
    if (classified.requestKey !== undefined) {
      mergeRequest(requests, events, parsed, rec, record, ts, agentId, classified.requestKey, usedIds, requestIds);
    }
    // A prompt titles the session only from the main lane; explicit titles do so from anywhere.
    if (classified.promptTitle !== undefined && !agentId) {
      rememberTitle(classified.promptTitle);
    }
    if (classified.title !== undefined) {
      rememberTitle(classified.title.text, classified.title.explicit);
    }
    if (classified.skip !== undefined) {
      skipRecord(skipped, record, classified.skip);
    }
    classified.events.forEach((eventPart, part) => {
      let id = eventId(uuid, record, part);
      // A record uuid that a request event already holds moves to the record's line id, first free serial; a uuid
      // two records share keeps the id both name, which the collision issue leaves as today's behavior.
      if (requestIds.has(id)) {
        id = nextFree(lineId(record, part));
      }
      usedIds.add(id);
      const event = baseEvent(record, eventPart.kind, eventPart.payload, {
        id,
        ts,
        agentId,
        parentId,
        requestId: classified.requestKey
      });
      events.push(event);
      parsed.set(event, rec);
    });
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
