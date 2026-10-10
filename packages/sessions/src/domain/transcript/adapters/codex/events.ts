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
  shadowBefore,
  sourceOf,
  type StampedRecord,
  type TranscriptEvent,
  type TranscriptEventKind,
  type TranscriptSession,
  type UnknownFormatGeneration,
  unknownFormatGeneration
} from "../../index.js";
import { type CodexHistoryItemValue } from "./records.js";
import { codexSessionStem } from "../../../session/adapters/codex/layout.js";
import { scanForkReplay } from "./fork-replay.js";
import { textFrom } from "./response-items.js";
import { createCodexTranslation } from "./translation.js";

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

/** What the translator keeps per event about the item that produced it, for the passes after the loop. */
interface CodexItemInfo {
  /** The ids Codex gave the item: its own `id` and `call_id`, non-empty. */
  ids: readonly string[];
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

/**
 * Translates the records of one rollout, stamped in file order (`mergeByTime([records])`), into transcript events.
 * The record dispatch — envelope resolution, the bare-item fallback, `codexRecordUsage` and its duplicate response
 * ids, the fork replay skips, request placement and its windows, `turn_aborted`'s interrupted request, the subagent
 * lanes and the item events — is `createCodexTranslation`'s, which the summarize pass shares; this function adds the
 * session extraction, the event identities and the passes after the loop.
 *
 * Event ids are the item's own `id`, else `L<line>`: a session is one rollout, so the line is unique, and the file
 * name would repeat its 70 characters on every id. Codex logs usage after the call's output, so each usage record
 * becomes a `request` placed before that output. `scanForkReplay` decides which records a forked rollout copied from
 * its parent, whose turn durations are skipped too.
 */
export function translateCodexRecords(
  stamped: readonly StampedRecord[],
  options: CodexTranslateOptions = {}
): Result<ParsedTranscript, UnknownFormatGeneration> {
  const translation = createCodexTranslation({ retain: true });
  const emitted = new Map<TranscriptEvent, CodexItemInfo>();
  const replay = scanForkReplay(stamped);
  let sessionId = options.sessionId;
  let cwd: string | undefined;
  let title: string | undefined;
  let agentVersion: string | undefined;
  let systemPrompt: string | undefined;
  let seenMeta = false;
  let startedAt: number | undefined;
  let endedAt: number | undefined;

  for (const [index, { record, ts }] of stamped.entries()) {
    const outcome = translation.step(record, ts, { replayed: index < replay.end, justEnded: index === replay.end });
    if (!outcome.ok) {
      return err(unknownFormatGeneration(AGENT, record));
    }
    // A legacy header (no envelope) carries no event and no time the session keeps.
    if (outcome.envelope !== undefined) {
      startedAt = Math.min(startedAt ?? ts, ts);
      endedAt = Math.max(endedAt ?? ts, ts);
    }
    if (outcome.envelope === "session_meta") {
      // A forked or resumed rollout repeats earlier sessions' `session_meta`; the first one is this file's.
      sessionId ??= outcome.payload.id ?? outcome.payload.session_id;
      cwd ??= outcome.payload.cwd;
      agentVersion ??= outcome.payload.cli_version;
      if (!seenMeta) {
        seenMeta = true;
        systemPrompt = outcome.payload.base_instructions?.text;
      }
    }
    if (outcome.envelope === undefined && outcome.rec?.record_type === undefined) {
      // An older rollout's header names the session; a `record_type` marker names nothing.
      sessionId ??= outcome.rec?.id;
    }
    if (!title && outcome.titleCandidate !== undefined) {
      title = outcome.titleCandidate.slice(0, 80);
    }
  }

  const events = translation.parts.map((part) => {
    const event = baseEvent(part.record, part.kind, part.payload, {
      id: part.id,
      ts: part.ts,
      agentId: part.agentId,
      requestId: part.requestId
    });
    emitted.set(event, {
      ids: part.itemIds,
      ...(part.callId === undefined ? {} : { callId: part.callId }),
      ...(part.output === undefined ? {} : { output: part.output }),
      ...(part.text === undefined ? {} : { text: part.text }),
      ...(part.history === undefined ? {} : { history: part.history })
    });
    return event;
  });

  shadowCompactions(events, emitted);
  linkSpawns(events, translation.agents, translation.agentByPath, emitted);
  markOrphanToolResults(events);
  assignSeq(events);
  const skipped = translation.skipped.map(({ reason, record }) => ({ reason, source: sourceOf(record) }));
  const session: TranscriptSession = {
    id:
      sessionId ?? (options.path === undefined ? undefined : codexSessionStem(options.path) || "unknown") ?? "unknown",
    ...(title ? { title } : {}),
    ...(cwd ? { cwd } : {}),
    ...(startedAt === undefined ? {} : { startedAt }),
    ...(endedAt === undefined ? {} : { endedAt }),
    ...(systemPrompt ? { systemPrompt } : {})
  };
  return ok({
    events,
    skipped,
    session,
    agents: [...translation.agents],
    ...(agentVersion ? { agentVersion } : {})
  });
}
