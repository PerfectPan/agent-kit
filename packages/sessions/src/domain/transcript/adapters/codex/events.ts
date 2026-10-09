import { err, ok, type Result } from "@rivus/agent-kit-catalog";
import * as z from "zod/mini";

import { lenient } from "../lenient.js";
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
} from "../../index.js";
import type { Usage } from "../../../usage/index.js";
import { codexPayload, type CodexHistoryItemValue, knownCodexRecord } from "./records.js";
import { codexSessionStem } from "../../../session/adapters/codex/layout.js";
import { scanForkReplay } from "./fork-replay.js";
import { emitResponseItem, INJECTED_USER, textFrom } from "./response-items.js";
import { codexRecordUsage, type CodexUsageTracker } from "../../../usage/adapters/codex.js";

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

/** What the translator keeps per event about the item that produced it, for the passes after the loop. */
interface CodexItemInfo {
  /** The ids Codex gave the item: its own `id` and `call_id`, non-empty. */
  ids: string[];
  /** The `callId` of the event's payload, as the item emitter wrote it. */
  callId?: string;
  /** The tool output of the event's payload, as the item emitter wrote it, read for the spawn link. */
  output?: unknown;
  /** The `text` the event's payload carries, when the item gave it one. */
  text?: string;
  /** The `replacement_history` of a `compacted` record. */
  history?: (CodexHistoryItemValue | undefined)[];
}

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
 * `codexRecordUsage` decides which usage records count, and `scanForkReplay` which records a forked rollout copied
 * from its parent, whose turn durations are skipped too.
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
  const emitted = new Map<TranscriptEvent, CodexItemInfo>();
  // The fork rule parses every record to find the replay's end; the loop reads those parsed values instead of the
  // schemas again.
  const replay = scanForkReplay(stamped);
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
    const rec = replay.records[index]!;
    if (!knownCodexRecord(rec)) {
      return err(unknownFormatGeneration(AGENT, record));
    }
    if (index === replay.end) {
      // The first request after a replay covers only the rollout's own records.
      segment = events.length;
    }
    const replayed = index < replay.end;
    const envelope = rec.type;
    if (envelope === undefined) {
      if (rec.record_type !== undefined) {
        skipRecord(skipped, record, `record-${rec.record_type}`);
      } else {
        sessionId ??= rec.id;
        skipRecord(skipped, record, "legacy-header");
      }
      continue;
    }
    const bare = (rec.payload === undefined || rec.payload === null) && BARE_ITEMS.has(envelope);
    // Reads see the payload record, or nothing when the payload is not a record. The item the ids come from is the
    // record itself then: an envelope without a payload still carries its own `id` and `call_id`.
    const recordItem = bare || replay.payloads[index] === undefined ? codexPayload(record.value) : undefined;
    const payload = bare ? (recordItem ?? {}) : (replay.payloads[index] ?? {});
    const item = recordItem ?? replay.payloads[index]!;
    startedAt = Math.min(startedAt ?? ts, ts);
    endedAt = Math.max(endedAt ?? ts, ts);

    const track = (event: TranscriptEvent): void => {
      emitted.set(event, {
        ids: [item.id, item.call_id].filter((id): id is string => id !== undefined && id !== "")
      });
    };

    const emit = (kind: TranscriptEventKind, body: Record<string, unknown>, id?: string): TranscriptEvent => {
      let eventId = id ?? payload.id ?? lineKey(record);
      if (usedIds.has(eventId)) {
        eventId = lineKey(record);
      }
      usedIds.add(eventId);
      const event = baseEvent(record, kind, body, { id: eventId, ts });
      events.push(event);
      track(event);
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
      track(event);
      segment = placeRequest(events, segment, event);
    };

    if (envelope === "session_meta") {
      // A forked or resumed rollout repeats earlier sessions' `session_meta`; the first one is this file's.
      sessionId ??= payload.id ?? payload.session_id;
      cwd ??= payload.cwd;
      agentVersion ??= payload.cli_version;
      if (!seenMeta) {
        seenMeta = true;
        systemPrompt = payload.base_instructions?.text;
      }
      skipRecord(skipped, record, "session-meta");
      continue;
    }
    if (envelope === "turn_context") {
      model = payload.model ?? model;
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
      const event = emit("compaction", {});
      // A bare record carries no payload, and the history of one is nobody's.
      if (!bare) {
        emitted.get(event)!.history = payload.replacement_history;
      }
      continue;
    }

    if (envelope === "event_msg") {
      const inner = payload.type ?? "event_msg";
      if (inner === "item_completed") {
        const item = payload.item;
        const agentId = item?.agent_thread_id;
        if (item?.type !== "SubAgentActivity" || !agentId) {
          skipRecord(skipped, record, "item-completed");
          continue;
        }
        if (!agents.some((agent) => agent.id === agentId)) {
          agents.push({ id: agentId, parentId: MAIN_LANE_ID });
        }
        if (item.agent_path) {
          agentByPath.set(item.agent_path, agentId);
        }
        const kind = item.kind;
        const event = emit("system", { type: "subagent", agentId, ...(kind ? { kind } : {}) }, item.id);
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
          request(undefined, undefined, payload.reason ?? "interrupted");
        }
        const durationMs = payload.duration_ms;
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
    const { event, text, callId, output } = emitResponseItem(
      bare ? envelope : (payload.type ?? "response_item"),
      payload,
      emit
    );
    const info = emitted.get(event)!;
    if (text !== undefined) {
      info.text = text;
    }
    if (callId !== undefined) {
      info.callId = callId;
    }
    if (output !== undefined) {
      info.output = output;
    }
    if (event.kind === "user" && !(text !== undefined && INJECTED_USER.test(text)) && !title) {
      title = text?.slice(0, 80);
    }
  }

  shadowCompactions(events, emitted);
  linkSpawns(events, agents, agentByPath, emitted);
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
function itemKind(item: CodexHistoryItemValue): TranscriptEventKind | undefined {
  const type = item.type ?? "";
  return type === "message" ? HISTORY_KIND[item.role ?? ""] : ITEM_KIND[type];
}

/**
 * The events a `replacement_history` keeps. Each item keeps at most one event, the latest one it matches that no
 * other item keeps, so two equal messages stay two only when the history has them twice. An item whose id an earlier
 * event carries matches by id; any other item (no id, or one Codex assigned anew) by role and text. Items matching by
 * id choose first, so a text match never takes the event an id names.
 */
function keptEvents(
  candidates: readonly TranscriptEvent[],
  items: readonly CodexHistoryItemValue[],
  carried: ReadonlySet<string>,
  emitted: ReadonlyMap<TranscriptEvent, CodexItemInfo>
): Set<TranscriptEvent> {
  const kept = new Set<TranscriptEvent>();
  const claim = (matches: (event: TranscriptEvent) => boolean): void => {
    const event = candidates.findLast((candidate) => !kept.has(candidate) && matches(candidate));
    if (event) {
      kept.add(event);
    }
  };
  const idOf = (item: CodexHistoryItemValue): string | undefined => {
    const id = item.id ?? item.call_id;
    return id && carried.has(id) ? id : undefined;
  };
  for (const item of items) {
    const id = idOf(item);
    const kind = itemKind(item);
    if (id) {
      claim((event) => (kind === undefined || event.kind === kind) && (emitted.get(event)?.ids ?? []).includes(id));
    }
  }
  for (const item of items) {
    const kind = itemKind(item);
    const text = textFrom(item.content);
    if (!idOf(item) && item.type === "message" && kind && text !== undefined) {
      claim((event) => event.kind === kind && emitted.get(event)?.text === text);
    }
  }
  return kept;
}

/** A `compacted` record removes the earlier events of its lane that its `replacement_history` does not keep. */
function shadowCompactions(
  events: readonly TranscriptEvent[],
  emitted: ReadonlyMap<TranscriptEvent, CodexItemInfo>
): void {
  const carried = new Set<string>();
  for (const [index, event] of events.entries()) {
    if (event.kind === "compaction") {
      const history = emitted.get(event)?.history;
      const lane = event.agentId ?? "";
      const kept = history
        ? keptEvents(
            events.slice(0, index).filter((earlier) => (earlier.agentId ?? "") === lane && !earlier.shadowedBy),
            history.filter((item): item is CodexHistoryItemValue => item !== undefined),
            carried,
            emitted
          )
        : undefined;
      shadowBefore(events, event, kept ? (earlier) => kept.has(earlier) : undefined);
    }
    for (const id of emitted.get(event)?.ids ?? []) {
      carried.add(id);
    }
  }
}

/** A spawn result: the spawn_agent tool's JSON output, or the object it already was. */
const SpawnResult = z.looseObject({ agent_id: lenient(z.string()), task_name: lenient(z.string()) });

function spawnResultOf(output: unknown): z.output<typeof SpawnResult> | undefined {
  if (typeof output !== "string") {
    return z.safeParse(SpawnResult, output).data;
  }
  try {
    return z.safeParse(SpawnResult, JSON.parse(output)).data;
  } catch {
    return undefined;
  }
}

/**
 * Sets each subagent lane's `spawnEventId` to the `spawn_agent` call whose result names it: by `agent_id` (the
 * lane id), or by `task_name`, which newer Codex sets to the `agent_path` of the subagent's activity records.
 */
function linkSpawns(
  events: readonly TranscriptEvent[],
  agents: readonly Lane[],
  agentByPath: ReadonlyMap<string, string>,
  emitted: ReadonlyMap<TranscriptEvent, CodexItemInfo>
): void {
  const spawns = new Map<string, TranscriptEvent>();
  for (const event of events) {
    if (event.kind === "tool_call" && event.payload.name === "spawn_agent") {
      spawns.set(emitted.get(event)?.callId ?? "", event);
    }
  }
  const spawnOf = new Map<string, TranscriptEvent>();
  for (const event of events) {
    const spawn = event.kind === "tool_result" ? spawns.get(emitted.get(event)?.callId ?? "") : undefined;
    const result = spawn ? spawnResultOf(emitted.get(event)?.output) : undefined;
    const agentId = result?.agent_id ?? agentByPath.get(result?.task_name ?? "");
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
