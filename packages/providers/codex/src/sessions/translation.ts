import {
  MAIN_LANE_ID,
  type Lane,
  type SourcedRecord,
  type TranscriptEventBody,
  type TranscriptEventKind,
  OUTPUT_KINDS,
  placeRequest,
  type Usage
} from "@rivus/agent-kit-sessions/spi";
import {
  codexPayload,
  type CodexHistoryItemValue,
  type CodexPayloadValue,
  type CodexRecordValue,
  codexRecord,
  knownCodexRecord
} from "../records/record.js";
import { codexRecordUsage, type CodexUsageTracker } from "../records/usage.js";
import { emitResponseItem } from "./response-items.js";

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

/** `event_msg` types that only the CLI reads, with the reason each is skipped for. */
const EVENT_MARKERS = new Map([
  ["task_started", "task-marker"],
  ["thread_settings_applied", "thread-settings"],
  ["thread_goal_updated", "thread-goal"]
]);

/** Envelopes that only the CLI reads, with the reason each is skipped for. */
const BOOKKEEPING = new Map([
  ["world_state", "world-state"],
  ["inter_agent_communication_metadata", "inter-agent"]
]);

const lineKey = (record: SourcedRecord): string => `L${record.line}`;

/**
 * One event the Codex translation emits, with what the post-passes and the summarize pass read beside it: the item
 * ids (`payload.id` and `call_id`, or the subagent item's), the call id, output and text the item carried, and the
 * `replacement_history` of a compacted record. `id` is the event id the translation gives it, `ts` the record's time
 * or, for a placed request, the output's, and `requestId` the window tag `placeRequest` writes.
 */
export type CodexPart<K extends TranscriptEventKind = TranscriptEventKind> = TranscriptEventBody<K> & CodexPartFields;

/** What a `CodexPart` carries beside its kind and payload. */
interface CodexPartFields {
  id: string;
  ts: number;
  requestId?: string;
  agentId?: string;
  record: SourcedRecord;
  itemIds: readonly string[];
  callId?: string;
  output?: unknown;
  text?: string;
  history?: (CodexHistoryItemValue | undefined)[];
}

/** Where a record sits in its replay, as the batch rule (`scanForkReplay`) and the streaming passes see it. */
export interface CodexReplayView {
  /** Whether the record is a copy of the rollout's parent: `index < end` in the batch rule. */
  readonly replayed: boolean;
  /** Whether this record is the first one after the replay, which resets the request window. */
  readonly justEnded: boolean;
}

/** What one stepped record becomes, beside the parsed values the translation's own extraction reads. */
export interface CodexStep {
  /** `false` when the record is of a format generation this adapter does not know. */
  ok: boolean;
  rec: CodexRecordValue | undefined;
  payload: CodexPayloadValue;
  envelope: string | undefined;
  /** The events this record emitted, in order. */
  parts: readonly CodexPart[];
  /** The title text a user item carried, when the record went through the item branch. */
  titleCandidate?: string;
}

/** Why a record became no event, as the translation's skipped records report it. */
export interface CodexSkip {
  reason: string;
  record: SourcedRecord;
}

/**
 * The Codex record dispatch the translation and the summarize pass share: envelope resolution, the bare-item
 * fallback, `codexRecordUsage` and its duplicate response ids, the fork replay skips, request placement and its
 * windows (`segment`, `turnStart`), `turn_aborted`'s interrupted request, the subagent lanes, and the item events
 * from `emitResponseItem`. The consumers differ only in what they keep:
 *
 * - `retain` keeps the event sequence — ids, placements, window tags, skips, `agent_path` links — so the
 *   translation can run its passes over it. This holds one entry per event: the translation does that anyway.
 * - Without `retain` the step returns each record's parts and keeps only counters and the running numbers, so a
 *   summarize pass holds nothing that grows with events; ids lose their duplicate protection and window tags and
 *   skips are not reported, which no summary number reads.
 */
export interface CodexTranslation {
  /** The events emitted so far, in order; empty forever without `retain`. */
  readonly parts: readonly CodexPart[];
  /** The records that became no event; empty forever without `retain`. */
  readonly skipped: readonly CodexSkip[];
  /** The lanes: the main lane first, one per distinct subagent thread. */
  readonly agents: readonly Lane[];
  readonly agentByPath: ReadonlyMap<string, string>;
  step(record: SourcedRecord, ts: number, replay: CodexReplayView): CodexStep;
}

export function createCodexTranslation(options: { readonly retain: boolean }): CodexTranslation {
  const retain = options.retain;
  const parts: CodexPart[] = [];
  const skips: CodexSkip[] = [];
  const usedIds = new Set<string>();
  const responses = new Set<string>();
  const agents: Lane[] = [{ id: MAIN_LANE_ID }];
  const agentByPath = new Map<string, string>();
  const tracker: CodexUsageTracker = { usageRecords: false };
  let model: string | undefined;
  let segment = 0;
  let turnStart = 0;
  let eventCount = 0;
  /** The event index of the last model output, or −1: the interrupted window needs no event history. */
  let lastOutputIndex = -1;

  return {
    parts: retain ? parts : [],
    skipped: retain ? skips : [],
    agents,
    agentByPath,
    step(record, ts, replay) {
      const noteSkip = (reason: string): void => {
        if (retain) {
          skips.push({ reason, record });
        }
      };
      const rec = codexRecord(record.value);
      if (!knownCodexRecord(rec)) {
        return {
          ok: false,
          rec: undefined,
          payload: {} as CodexPayloadValue,
          item: undefined,
          bare: false,
          envelope: undefined,
          parts: []
        };
      }
      if (replay.justEnded) {
        // The first request after a replay covers only the rollout's own records.
        segment = eventCount;
      }
      const envelope = rec.type;
      if (envelope === undefined) {
        if (rec.record_type !== undefined) {
          noteSkip(`record-${rec.record_type}`);
        } else {
          noteSkip("legacy-header");
        }
        return {
          ok: true,
          rec,
          payload: {} as CodexPayloadValue,
          item: undefined,
          bare: false,
          envelope: undefined,
          parts: []
        };
      }
      const bare = (rec.payload === undefined || rec.payload === null) && BARE_ITEMS.has(envelope);
      // Reads see the payload record, or nothing when the payload is not a record. The item the ids come from is the
      // record itself then: an envelope without a payload still carries its own `id` and `call_id`.
      const parsedPayload = codexPayload(rec.payload);
      const recordItem = bare || parsedPayload === undefined ? codexPayload(record.value) : undefined;
      const payload = (bare ? (recordItem ?? {}) : (parsedPayload ?? {})) as CodexPayloadValue;
      const item = recordItem ?? parsedPayload!;
      const itemIds = [item.id, item.call_id].filter((id): id is string => id !== undefined && id !== "");
      const recordParts: CodexPart[] = [];

      const track = (part: CodexPart): void => {
        part.itemIds = itemIds;
      };

      // Event ids stay unique because every id is taken only while `usedIds` does not hold it, and the check runs
      // only where ids are retained. A taken id moves to the next free serial of the record's line key — not of the
      // item's own id. The pattern guarantees nothing by itself: an item may carry any id, `request:<key>` or
      // `L<n>:<serial>` included, so the check at emission is what keeps ids apart.
      const nextFree = (base: string, serial = 0): string => {
        let candidate = serial === 0 ? base : `${base}:${serial}`;
        while (usedIds.has(candidate)) {
          serial += 1;
          candidate = `${base}:${serial}`;
        }
        return candidate;
      };

      const emit = (body: TranscriptEventBody, id?: string): CodexPart => {
        let eventId = id ?? payload.id ?? lineKey(record);
        if (retain) {
          if (usedIds.has(eventId)) {
            eventId = nextFree(lineKey(record));
          }
          usedIds.add(eventId);
        }
        const part: CodexPart = { ...body, id: eventId, ts, record, itemIds: [] };
        if (OUTPUT_KINDS.has(body.kind)) {
          lastOutputIndex = eventCount;
        }
        eventCount += 1;
        if (retain) {
          parts.push(part);
        }
        recordParts.push(part);
        track(part);
        return part;
      };

      const request = (usage: Usage | undefined, responseId?: string, finishReason?: string): void => {
        const key = responseId ?? lineKey(record);
        const body = {
          ...(model ? { model } : {}),
          ...(responseId ? { responseId } : {}),
          ...(usage ? { usage } : {}),
          ...(finishReason ? { finishReason } : {})
        };
        // The request keeps `request:<key>` when free, else the first free serial of it; `requestId` keeps the key.
        let id = `request:${key}`;
        if (retain) {
          id = nextFree(id);
          usedIds.add(id);
        }
        const part: CodexPart<"request"> = {
          kind: "request",
          payload: body,
          id,
          ts,
          requestId: key,
          record,
          itemIds: []
        };
        track(part);
        recordParts.push(part);
        eventCount += 1;
        if (retain) {
          segment = placeRequest(parts, segment, part);
        } else {
          segment = eventCount;
        }
      };

      if (envelope === "session_meta") {
        // A forked or resumed rollout repeats earlier sessions' `session_meta`; the first one is this file's.
        noteSkip("session-meta");
        return { ok: true, rec, payload, envelope, parts: recordParts };
      }
      if (envelope === "turn_context") {
        model = payload.model ?? model;
        noteSkip("turn-context");
        return { ok: true, rec, payload, envelope, parts: recordParts };
      }
      const bookkeeping = BOOKKEEPING.get(envelope);
      if (bookkeeping) {
        noteSkip(bookkeeping);
        return { ok: true, rec, payload, envelope, parts: recordParts };
      }
      const found = codexRecordUsage(tracker, envelope, payload, replay.replayed, (responseId) => {
        if (responses.has(responseId)) {
          return true;
        }
        responses.add(responseId);
        return false;
      });
      if (found) {
        if ("skip" in found) {
          noteSkip(found.skip);
        } else {
          request(found.usage, found.responseId);
        }
        return { ok: true, rec, payload, envelope, parts: recordParts };
      }
      if (
        envelope === "compacted" ||
        (bare && envelope === "compaction") ||
        (envelope === "response_item" && payload.type === "compaction")
      ) {
        const part = emit({ kind: "compaction", payload: {} });
        // A bare record carries no payload, and the history of one is nobody's.
        if (!bare) {
          part.history = payload.replacement_history;
        }
        return { ok: true, rec, payload, envelope, parts: recordParts };
      }

      if (envelope === "event_msg") {
        const inner = payload.type ?? "event_msg";
        if (inner === "item_completed") {
          const innerItem = payload.item;
          const agentId = innerItem?.agent_thread_id;
          if (innerItem?.type !== "SubAgentActivity" || !agentId) {
            noteSkip("item-completed");
            return { ok: true, rec, payload, envelope, parts: recordParts };
          }
          if (!agents.some((agent) => agent.id === agentId)) {
            agents.push({ id: agentId, parentId: MAIN_LANE_ID });
          }
          if (retain && innerItem.agent_path) {
            agentByPath.set(innerItem.agent_path, agentId);
          }
          const kind = innerItem.kind;
          const part = emit(
            { kind: "system", payload: { type: "subagent", agentId, ...(kind ? { kind } : {}) } },
            innerItem.id
          );
          part.agentId = agentId;
          return { ok: true, rec, payload, envelope, parts: recordParts };
        }
        if (inner === "task_started") {
          turnStart = eventCount;
        }
        if (inner === "task_complete" || inner === "turn_aborted") {
          const windowStart = Math.max(segment, turnStart);
          const outputSince = retain
            ? parts.slice(windowStart).some((part) => OUTPUT_KINDS.has(part.kind))
            : lastOutputIndex >= windowStart;
          // A usage record means the response finished. Model output after the turn's last one is the response the
          // cancel interrupted, which Codex records no usage for: it becomes a request of its own.
          const interrupted = inner === "turn_aborted" && !replay.replayed && outputSince;
          if (interrupted) {
            segment = Math.max(segment, turnStart);
            request(undefined, undefined, payload.reason ?? "interrupted");
          }
          const durationMs = payload.duration_ms;
          if (durationMs === undefined || replay.replayed) {
            if (!interrupted) {
              noteSkip(durationMs === undefined ? "task-marker" : "fork-replay");
            }
            return { ok: true, rec, payload, envelope, parts: recordParts };
          }
          // The turn's duration stays on the turn marker, never on a request.
          emit(
            {
              kind: "system",
              payload: { type: "turn_duration", durationMs, ...(inner === "turn_aborted" ? { aborted: true } : {}) }
            },
            lineKey(record)
          );
          return { ok: true, rec, payload, envelope, parts: recordParts };
        }
        const marker = EVENT_MARKERS.get(inner);
        if (marker) {
          noteSkip(marker);
        } else {
          emit({ kind: "unknown", payload: { type: inner } }, lineKey(record));
        }
        return { ok: true, rec, payload, envelope, parts: recordParts };
      }

      if (envelope !== "response_item" && !bare) {
        emit({ kind: "unknown", payload: { type: envelope } }, lineKey(record));
        return { ok: true, rec, payload, envelope, parts: recordParts };
      }
      const { text, callId, output } = emitResponseItem(
        bare ? envelope : (payload.type ?? "response_item"),
        payload,
        (body) => emit(body)
      );
      const last = recordParts[recordParts.length - 1]!;
      if (text !== undefined) {
        last.text = text;
      }
      if (callId !== undefined) {
        last.callId = callId;
      }
      if (output !== undefined) {
        last.output = output;
      }
      const outcome: CodexStep = { ok: true, rec, payload, envelope, parts: recordParts };
      if (last.kind === "user" && last.payload.injected !== true && typeof last.payload.text === "string") {
        outcome.titleCandidate = last.payload.text;
      }
      return outcome;
    }
  };
}
