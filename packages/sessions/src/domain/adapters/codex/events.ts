import { err, ok, type Result } from "@rivus/agent-kit-catalog";

import {
  assignSeq,
  baseEvent,
  type Capability,
  type Lane,
  MAIN_LANE_ID,
  markOrphanToolResults,
  type ParsedTranscript,
  placeRequest,
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
import { codexSessionStem } from "./layout.js";
import { forkReplayEnd } from "./fork-replay.js";
import { emitResponseItem, textFrom } from "./response-items.js";
import { codexRecordUsage, type CodexUsageTracker, knownCodexGeneration } from "./usage.js";

const AGENT = "codex";

/** Recorded by every rollout this adapter reads. */
const BASE_CAPABILITIES: readonly Capability[] = [
  "requests",
  "usage",
  "durations",
  "reasoning",
  "compaction",
  "subagents"
];

/**
 * Everything a Codex transcript can list. `systemPrompt` is `session_meta.base_instructions.text`, which older
 * rollouts leave out, so a transcript lists it only when its file records it. Tool schemas are not recorded
 * (`dynamic_tools` lists only the dynamic ones).
 */
export const CODEX_CAPABILITIES: readonly Capability[] = [...BASE_CAPABILITIES, "systemPrompt"];

/** The capabilities one translated transcript shows. */
export function codexCapabilities(session: TranscriptSession): Capability[] {
  return session.systemPrompt ? [...BASE_CAPABILITIES, "systemPrompt"] : [...BASE_CAPABILITIES];
}

/** Item types that older rollouts write bare, without the `response_item` envelope. */
const BARE_ITEMS = new Set([
  "message",
  "reasoning",
  "function_call",
  "function_call_output",
  "custom_tool_call",
  "custom_tool_call_output",
  "compaction",
  "agent_message",
  "web_search_call"
]);

/** Envelopes that only the CLI reads, with the reason each is skipped for. */
const BOOKKEEPING = new Map([
  ["world_state", "world-state"],
  ["inter_agent_communication_metadata", "inter-agent"]
]);
/** Events a model response produces; their request is placed before the first of them. */
const MODEL_OUTPUT = new Set<TranscriptEventKind>(["assistant", "reasoning", "tool_call"]);

/** `event_msg` types that only the CLI reads, with the reason each is skipped for. */
const EVENT_MARKERS = new Map([
  ["task_started", "task-marker"],
  ["thread_settings_applied", "thread-settings"],
  ["thread_goal_updated", "thread-goal"]
]);

export interface CodexTranslateOptions {
  /** Wins over the id the rollout records. */
  sessionId?: string;
  /** The rollout file's path, whose name is the session's fallback id when neither this option nor the rollout names one. */
  path?: string;
}

/**
 * Translates the records of one rollout, stamped in file order (`mergeByTime([records])`), into transcript events.
 * Event ids are the item's own `id`, else `L<line>`: a session is one rollout, so the line is unique, and the file
 * name would repeat its 70 characters on every id.
 *
 * Codex logs usage after the call's output, so each usage record becomes a `request` placed before that output.
 * `codexRecordUsage` decides which usage records count, and `forkReplayEnd` which records a forked rollout copied from
 * its parent, whose turn durations are skipped too.
 */
export function translateCodexRecords(
  stamped: readonly StampedRecord[],
  options: CodexTranslateOptions = {}
): Result<ParsedTranscript, UnknownFormatGeneration> {
  const events: TranscriptEvent[] = [];
  const skipped: SkippedRecord[] = [];
  const usedIds = new Set<string>();
  const responses = new Set<string>();
  const agents: Lane[] = [{ id: MAIN_LANE_ID }];
  const agentByPath = new Map<string, string>();
  const replayEnd = forkReplayEnd(stamped);
  let sessionId = options.sessionId;
  let cwd: string | undefined;
  let title: string | undefined;
  let agentVersion: string | undefined;
  let systemPrompt: string | undefined;
  let seenMeta = false;
  let startedAt: number | undefined;
  let endedAt: number | undefined;
  let model: string | undefined;
  const tracker: CodexUsageTracker = { usageRecords: false };
  let segment = 0;
  let turnStart = 0;

  for (const [index, { record, ts }] of stamped.entries()) {
    const rec = asRecord(record.value);
    if (!rec || !knownCodexGeneration(rec)) {
      return err(unknownFormatGeneration(AGENT, record));
    }
    if (index === replayEnd) {
      // The first request after a replay covers only the rollout's own records.
      segment = events.length;
    }
    const replayed = index < replayEnd;
    const envelope = asString(rec.type);
    if (!envelope) {
      const recordType = asString(rec.record_type);
      if (recordType) {
        skipRecord(skipped, record, `record-${recordType}`);
      } else {
        sessionId ??= asString(rec.id);
        skipRecord(skipped, record, "legacy-header");
      }
      continue;
    }
    const bare = (rec.payload === undefined || rec.payload === null) && BARE_ITEMS.has(envelope);
    const payload = bare ? rec : (asRecord(rec.payload) ?? {});
    startedAt = Math.min(startedAt ?? ts, ts);
    endedAt = Math.max(endedAt ?? ts, ts);

    const emit = (kind: TranscriptEventKind, body: Record<string, unknown>, id?: string): TranscriptEvent => {
      let eventId = id ?? asString(payload.id) ?? lineKey(record);
      if (usedIds.has(eventId)) {
        eventId = lineKey(record);
      }
      usedIds.add(eventId);
      const event = baseEvent(record, kind, body, { id: eventId, ts });
      events.push(event);
      return event;
    };

    const request = (usage: Usage | undefined, responseId?: string, finishReason?: string): void => {
      const key = responseId ?? lineKey(record);
      const body = {
        ...(model ? { model } : {}),
        ...(responseId ? { responseId } : {}),
        ...(usage ? { usage } : {}),
        ...(finishReason ? { finishReason } : {})
      };
      const event = baseEvent(record, "request", body, { id: `request:${key}`, ts, requestId: key });
      usedIds.add(event.id);
      segment = placeRequest(events, segment, event);
    };

    if (envelope === "session_meta") {
      // A forked or resumed rollout repeats earlier sessions' `session_meta`; the first one is this file's.
      sessionId ??= asString(payload.id) ?? asString(payload.session_id);
      cwd ??= asString(payload.cwd);
      agentVersion ??= asString(payload.cli_version);
      if (!seenMeta) {
        seenMeta = true;
        systemPrompt = asString(asRecord(payload.base_instructions)?.text);
      }
      skipRecord(skipped, record, "session-meta");
      continue;
    }
    if (envelope === "turn_context") {
      model = asString(payload.model) ?? model;
      skipRecord(skipped, record, "turn-context");
      continue;
    }
    const bookkeeping = BOOKKEEPING.get(envelope);
    if (bookkeeping) {
      skipRecord(skipped, record, bookkeeping);
      continue;
    }
    const found = codexRecordUsage(tracker, envelope, payload, replayed, (responseId) => {
      if (responses.has(responseId)) {
        return true;
      }
      responses.add(responseId);
      return false;
    });
    if (found) {
      if ("skip" in found) {
        skipRecord(skipped, record, found.skip);
      } else {
        request(found.usage, found.responseId);
      }
      continue;
    }
    if (
      envelope === "compacted" ||
      (bare && envelope === "compaction") ||
      (envelope === "response_item" && payload.type === "compaction")
    ) {
      emit("compaction", {});
      continue;
    }

    if (envelope === "event_msg") {
      const inner = asString(payload.type) ?? "event_msg";
      if (inner === "item_completed") {
        const item = asRecord(payload.item);
        const agentId = asString(item?.agent_thread_id);
        if (item?.type !== "SubAgentActivity" || !agentId) {
          skipRecord(skipped, record, "item-completed");
          continue;
        }
        if (!agents.some((agent) => agent.id === agentId)) {
          agents.push({ id: agentId, parentId: MAIN_LANE_ID });
        }
        const path = asString(item.agent_path);
        if (path) {
          agentByPath.set(path, agentId);
        }
        const kind = asString(item.kind);
        const event = emit("system", { type: "subagent", agentId, ...(kind ? { kind } : {}) }, asString(item.id));
        event.agentId = agentId;
        continue;
      }
      if (inner === "task_started") {
        turnStart = events.length;
      }
      if (inner === "task_complete" || inner === "turn_aborted") {
        // A usage record means the response finished. Model output after the turn's last one is the response the
        // cancel interrupted, which Codex records no usage for: it becomes a request of its own.
        const interrupted =
          inner === "turn_aborted" &&
          !replayed &&
          events.slice(Math.max(segment, turnStart)).some((event) => MODEL_OUTPUT.has(event.kind));
        if (interrupted) {
          segment = Math.max(segment, turnStart);
          request(undefined, undefined, asString(payload.reason) ?? "interrupted");
        }
        const durationMs = asNumber(payload.duration_ms);
        if (durationMs === undefined || replayed) {
          if (!interrupted) {
            skipRecord(skipped, record, durationMs === undefined ? "task-marker" : "fork-replay");
          }
          continue;
        }
        // The turn's duration stays on the turn marker, never on a request.
        emit(
          "system",
          { type: "turn_duration", durationMs, ...(inner === "turn_aborted" ? { aborted: true } : {}) },
          lineKey(record)
        );
        continue;
      }
      const marker = EVENT_MARKERS.get(inner);
      if (marker) {
        skipRecord(skipped, record, marker);
      } else {
        emit("unknown", { type: inner }, lineKey(record));
      }
      continue;
    }

    if (envelope !== "response_item" && !bare) {
      emit("unknown", { type: envelope }, lineKey(record));
      continue;
    }
    const event = emitResponseItem(bare ? envelope : (asString(payload.type) ?? "response_item"), payload, emit);
    if (event.kind === "user" && !event.payload.injected && !title) {
      title = asString(event.payload.text)?.slice(0, 80);
    }
  }

  shadowCompactions(events);
  linkSpawns(events, agents, agentByPath);
  markOrphanToolResults(events);
  assignSeq(events);
  const session: TranscriptSession = {
    id:
      sessionId ?? (options.path === undefined ? undefined : codexSessionStem(options.path) || "unknown") ?? "unknown",
    ...(title ? { title } : {}),
    ...(cwd ? { cwd } : {}),
    ...(startedAt === undefined ? {} : { startedAt }),
    ...(endedAt === undefined ? {} : { endedAt }),
    ...(systemPrompt ? { systemPrompt } : {})
  };
  return ok({ events, skipped, session, agents, ...(agentVersion ? { agentVersion } : {}) });
}

function lineKey(record: SourcedRecord): string {
  return `L${record.line}`;
}

/** The ids Codex gave the record of an event: the item's `id` and `call_id`. */
function itemIds(event: TranscriptEvent): string[] {
  const item = asRecord(asRecord(event.original)?.payload) ?? asRecord(event.original);
  const ids = [asString(item?.id), asString(item?.call_id), asString(event.payload.callId)];
  return ids.filter((id): id is string => Boolean(id));
}

const HISTORY_KIND: Readonly<Record<string, TranscriptEventKind>> = {
  user: "user",
  assistant: "assistant",
  developer: "system"
};

const ITEM_KIND: Readonly<Record<string, TranscriptEventKind>> = {
  reasoning: "reasoning",
  function_call: "tool_call",
  custom_tool_call: "tool_call",
  web_search_call: "tool_call",
  tool_search_call: "tool_call",
  function_call_output: "tool_result",
  custom_tool_call_output: "tool_result",
  tool_search_output: "tool_result",
  agent_message: "system"
};

/** The event kind a history item was translated to; a call and its output share a `call_id` but not a kind. */
function itemKind(item: Record<string, unknown>): TranscriptEventKind | undefined {
  const type = asString(item.type) ?? "";
  return type === "message" ? HISTORY_KIND[asString(item.role) ?? ""] : ITEM_KIND[type];
}

/**
 * The events a `replacement_history` keeps. Each item keeps at most one event, the latest one it matches that no
 * other item keeps, so two equal messages stay two only when the history has them twice. An item whose id an earlier
 * event carries matches by id; any other item (no id, or one Codex assigned anew) by role and text. Items matching by
 * id choose first, so a text match never takes the event an id names.
 */
function keptEvents(
  candidates: readonly TranscriptEvent[],
  items: readonly Record<string, unknown>[],
  carried: ReadonlySet<string>
): Set<TranscriptEvent> {
  const kept = new Set<TranscriptEvent>();
  const claim = (matches: (event: TranscriptEvent) => boolean): void => {
    const event = candidates.findLast((candidate) => !kept.has(candidate) && matches(candidate));
    if (event) {
      kept.add(event);
    }
  };
  const idOf = (item: Record<string, unknown>): string | undefined => {
    const id = asString(item.id) ?? asString(item.call_id);
    return id && carried.has(id) ? id : undefined;
  };
  for (const item of items) {
    const id = idOf(item);
    const kind = itemKind(item);
    if (id) {
      claim((event) => (kind === undefined || event.kind === kind) && itemIds(event).includes(id));
    }
  }
  for (const item of items) {
    const kind = itemKind(item);
    const text = textFrom(item.content);
    if (!idOf(item) && asString(item.type) === "message" && kind && text !== undefined) {
      claim((event) => event.kind === kind && event.payload.text === text);
    }
  }
  return kept;
}

/** A `compacted` record removes the earlier events of its lane that its `replacement_history` does not keep. */
function shadowCompactions(events: readonly TranscriptEvent[]): void {
  const carried = new Set<string>();
  for (const [index, event] of events.entries()) {
    if (event.kind === "compaction") {
      const history = asRecord(asRecord(event.original)?.payload)?.replacement_history;
      const lane = event.agentId ?? "";
      const kept = Array.isArray(history)
        ? keptEvents(
            events.slice(0, index).filter((earlier) => (earlier.agentId ?? "") === lane && !earlier.shadowedBy),
            history.map((item) => asRecord(item)).filter((item): item is Record<string, unknown> => item !== undefined),
            carried
          )
        : undefined;
      shadowBefore(events, event, kept ? (earlier) => kept.has(earlier) : undefined);
    }
    for (const id of itemIds(event)) {
      carried.add(id);
    }
  }
}

function callIdOf(event: TranscriptEvent): string | undefined {
  return asString(event.payload.callId);
}

/**
 * Sets each subagent lane's `spawnEventId` to the `spawn_agent` call whose result names it: by `agent_id` (the
 * lane id), or by `task_name`, which newer Codex sets to the `agent_path` of the subagent's activity records.
 */
function linkSpawns(
  events: readonly TranscriptEvent[],
  agents: readonly Lane[],
  agentByPath: ReadonlyMap<string, string>
): void {
  const spawns = new Map<string, TranscriptEvent>();
  for (const event of events) {
    if (event.kind === "tool_call" && event.payload.name === "spawn_agent") {
      spawns.set(callIdOf(event) ?? "", event);
    }
  }
  const spawnOf = new Map<string, TranscriptEvent>();
  for (const event of events) {
    const spawn = event.kind === "tool_result" ? spawns.get(callIdOf(event) ?? "") : undefined;
    const result = spawn ? jsonRecord(event.payload.output) : undefined;
    const agentId = asString(result?.agent_id) ?? agentByPath.get(asString(result?.task_name) ?? "");
    if (spawn && agentId && !spawnOf.has(agentId)) {
      spawnOf.set(agentId, spawn);
    }
  }
  for (const agent of agents) {
    const spawn = spawnOf.get(agent.id);
    if (agent.id !== MAIN_LANE_ID && spawn) {
      agent.spawnEventId = spawn.id;
    }
  }
}

function jsonRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== "string") {
    return asRecord(value);
  }
  try {
    return asRecord(JSON.parse(value) as unknown);
  } catch {
    return undefined;
  }
}
