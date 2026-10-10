import {
  baseEvent,
  type Lane,
  lineId,
  MAIN_LANE_ID,
  placeRequest,
  type SourcedRecord,
  type TranscriptEvent,
  type TranscriptEventKind
} from "../../index.js";
import {
  acpChunkText,
  acpMessageKind,
  acpToolCallPayload,
  acpToolResultPayload,
  type AcpToolState,
  isAcpToolDone,
  isAcpToolError,
  mergeAcpToolStatus,
  mergeAcpToolUpdate
} from "../acp-updates.js";
import { isInjectedChunk } from "./chunks.js";
import type { GrokSubagentMeta } from "../../../session/adapters/grok/layout.js";
import {
  followGrokTurn,
  type GrokHookRunValue,
  type GrokTurn,
  type GrokUpdateValue,
  grokTurnModel,
  grokTurnUsage,
  grokUsageByModel,
  grokUsageOf,
  knownGrokUpdate
} from "../../../usage/adapters/grok.js";

/** Record types that only the host reads. Each becomes a skipped record with its type as the reason. */
const BOOKKEEPING = new Set([
  "background_tasks",
  "task_backgrounded",
  "task_completed",
  "session_recap",
  "retry_state",
  "plan",
  "image_compressed"
]);

/** Host status updates kept as `system` events with their `type`. */
const STATUS = new Set(["goal_updated", "memory_dream_queued", "memory_dream_started", "memory_dream_completed"]);

/** A `request` for one turn. Grok's cost (`costUsdTicks`) stays on the original record; `decodeUsage` reports it. */
function requestPayload(update: GrokUpdateValue, turnModel: string | undefined): Record<string, unknown> {
  const raw = grokTurnUsage(update);
  const usage = grokUsageOf(raw);
  const model = grokTurnModel(raw?.modelUsage, turnModel);
  const byModel = grokUsageByModel(raw?.modelUsage);
  // `baseEvent` stores a record. `satisfies` keeps the fields on the request payload shape.
  return {
    granularity: "turn",
    ...(model ? { model } : {}),
    ...(usage ? { usage } : {}),
    ...(update.stop_reason ? { finishReason: update.stop_reason } : {}),
    ...(raw?.modelCalls === undefined ? {} : { modelCalls: raw.modelCalls }),
    ...(byModel ? { usageByModel: byModel } : {})
  };
}

/** The fields of one hook run the event keeps; a field the run does not record stays absent. */
function hookRunBody(run: GrokHookRunValue): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  if (run.name) {
    body.name = run.name;
  }
  const state = run.status?.status;
  if (state) {
    body.status = state;
  }
  const elapsedMs = run.status?.elapsed_ms;
  if (elapsedMs !== undefined) {
    body.elapsedMs = elapsedMs;
  }
  const exitCode = run.exit_code ?? run.status?.exit_code;
  if (exitCode !== undefined) {
    body.exitCode = exitCode;
  }
  const output = run.output ?? run.status?.output;
  if (output) {
    body.output = output;
  }
  return body;
}

function hookRuns(runs: readonly (GrokHookRunValue | undefined)[] | undefined): Record<string, unknown>[] {
  return (runs ?? []).flatMap((run) => (run ? [hookRunBody(run)] : []));
}

/** Adds what each subagent directory's `meta.json` names: one lane per directory, under the id its meta names. */
export function applyGrokSubagents(agents: Lane[], subagents: ReadonlyMap<string, GrokSubagentMeta> | undefined): void {
  if (!subagents) {
    return;
  }
  for (const [dirName, meta] of subagents) {
    const id = meta.id ?? dirName;
    const existing = agents.find((agent) => agent.id === id);
    if (existing) {
      if (!existing.title && meta.title) {
        existing.title = meta.title;
      }
      continue;
    }
    const lane: Lane = { id, parentId: MAIN_LANE_ID };
    if (meta.title) {
      lane.title = meta.title;
    }
    agents.push(lane);
  }
}

/** One event a record emitted. With retain these are the emitted `TranscriptEvent`s themselves. */
export interface GrokPart {
  kind: TranscriptEventKind;
  payload: Record<string, unknown>;
  /** The event id; present with retain, absent in the bounded pass, which reads no ids. */
  id?: string;
}

/** Why a record became no event, as the translation's skipped records report it. */
export interface GrokSkip {
  reason: string;
  record: SourcedRecord;
}

/** What one stepped record becomes. */
export interface GrokStep {
  /** `false` when the record is of a format generation this adapter does not know. */
  ok: boolean;
  /** The events this record emitted, in order. */
  parts: readonly GrokPart[];
}

/** One call's events, for the rewrites later rows apply to them. */
interface ToolEvents {
  call?: TranscriptEvent;
  result?: TranscriptEvent;
}

/**
 * The Grok record dispatch the translation and the summarize pass share: the chunk kinds and their text, the
 * injected-chunk rule, `continued` prompts by prompt index, the tool merges and their done rows, `followGrokTurn`'s
 * turn aggregates, `turn_completed` requests and `elapsed_ms` durations, `auto_compact_*`, and the subagent ids.
 * The consumers differ only in what they keep:
 *
 * - `retain` keeps the event sequence with ids and the skipped records, so the translation can run its passes
 *   over it. This holds the events anyway.
 * - Without `retain` the step returns light parts and keeps only the running state the summary reads: the lanes,
 *   the turn strings, and one status per tool call. The mirror in `statuses` holds no `rawInput`/`rawOutput` bytes
 *   and grows with tool calls, never with them.
 */
export interface GrokTranslation {
  /** The events emitted so far, requests placed; empty forever without `retain`. */
  readonly events: readonly TranscriptEvent[];
  /** The records that became no event; empty forever without `retain`. */
  readonly skipped: readonly GrokSkip[];
  /** The lanes: the main lane first, one per subagent the log named. */
  readonly agents: readonly Lane[];
  /** The final failure of each call that reached a done status, keyed by call id; the summary's `failedTools`. */
  readonly toolResults: ReadonlyMap<string, boolean>;
  step(record: SourcedRecord, ts: number): GrokStep;
}

export function createGrokTranslation(options: { readonly retain: boolean }): GrokTranslation {
  const retain = options.retain;
  const events: TranscriptEvent[] = [];
  const skips: GrokSkip[] = [];
  const agents: Lane[] = [{ id: MAIN_LANE_ID }];
  const tools = new Map<string, AcpToolState>();
  /** The slim mirror of `tools`: a call id and its status, with no args or output text. */
  const statuses = new Map<string, AcpToolState>();
  const toolEvents = new Map<string, ToolEvents>();
  const toolResults = new Map<string, boolean>();
  const turn: GrokTurn = {};
  let lastUserPrompt: string | undefined;
  let segment = 0;

  const rememberAgent = (id: string, title?: string, spawnEventId?: string): void => {
    const existing = agents.find((agent) => agent.id === id);
    if (!retain) {
      // The summary counts lanes; their titles and spawn links name nothing it reads.
      if (!existing) {
        agents.push({ id, parentId: MAIN_LANE_ID });
      }
      return;
    }
    if (!existing) {
      const lane: Lane = { id, parentId: MAIN_LANE_ID };
      if (title) {
        lane.title = title;
      }
      if (spawnEventId) {
        lane.spawnEventId = spawnEventId;
      }
      agents.push(lane);
      return;
    }
    if (!existing.title && title) {
      existing.title = title;
    }
    if (!existing.spawnEventId && spawnEventId) {
      existing.spawnEventId = spawnEventId;
    }
  };

  return {
    events: retain ? events : [],
    skipped: retain ? skips : [],
    agents,
    toolResults,
    step(record, ts) {
      const parts: GrokPart[] = [];
      const update = knownGrokUpdate(record.value);
      if (!update) {
        return { ok: false, parts: [] };
      }
      const kind = update.sessionUpdate ?? "update";
      const noteSkip = (reason: string): void => {
        if (retain) {
          skips.push({ reason, record });
        }
      };
      const emit = (eventKind: TranscriptEventKind, payload: Record<string, unknown>): GrokPart => {
        if (!retain) {
          const part: GrokPart = { kind: eventKind, payload };
          parts.push(part);
          return part;
        }
        const event = baseEvent(record, eventKind, payload, { id: lineId(record), ts });
        events.push(event);
        parts.push(event);
        return event;
      };

      followGrokTurn(turn, update);
      const prompt = turn.prompt;

      const messageKind = acpMessageKind(kind);
      if (messageKind !== undefined) {
        const text = acpChunkText(update.content);
        if (messageKind !== "user") {
          emit(messageKind, text ? { text } : {});
          return { ok: true, parts };
        }
        const flags: Record<string, unknown> = {};
        if (isInjectedChunk(update._meta, text)) {
          flags.injected = true;
        }
        // A later chunk of a prompt that already started a turn does not start another.
        if (!flags.injected && prompt !== undefined && prompt === lastUserPrompt) {
          flags.continued = true;
        }
        if (!flags.injected) {
          lastUserPrompt = prompt;
        }
        emit("user", { ...flags, ...(text ? { text } : {}) });
        return { ok: true, parts };
      }

      if (kind === "tool_call" || kind === "tool_call_update") {
        // One merge rule, two states: the translation's ACP state carries args and output bytes, the pass's slim
        // mirror the status alone. The done predicates read the status off either.
        const state = retain ? mergeAcpToolUpdate(tools, update).state : mergeAcpToolStatus(statuses, update);
        // A result exists from the first done row on, and every later done row rewrites it; its final `isError`
        // is the rule at the last done row, which is the number the summary counts.
        const done = kind === "tool_call_update" && isAcpToolDone(state);
        if (done) {
          toolResults.set(state.callId, isAcpToolError(state));
        }
        if (retain) {
          const seen = toolEvents.get(state.callId) ?? {};
          toolEvents.set(state.callId, seen);
          // The payload is replaced whole, not merged field by field: a later update can take `title` away
          // again, and an Object.assign would leave the earlier title on the event.
          if (kind === "tool_call") {
            if (seen.call) {
              seen.call.payload = acpToolCallPayload(state);
              noteSkip("tool-progress");
              return { ok: true, parts };
            }
            seen.call = emit("tool_call", acpToolCallPayload(state)) as TranscriptEvent;
            return { ok: true, parts };
          }
          if (seen.call) {
            seen.call.payload = acpToolCallPayload(state);
          }
          if (!done) {
            noteSkip("tool-progress");
            return { ok: true, parts };
          }
          // A result with no earlier call stays an orphan. Inventing the call would hide that.
          if (!seen.result) {
            seen.result = emit("tool_result", acpToolResultPayload(state)) as TranscriptEvent;
            return { ok: true, parts };
          }
          Object.assign(seen.result.payload, acpToolResultPayload(state));
          noteSkip("tool-progress");
        }
        return { ok: true, parts };
      }

      if (kind === "turn_completed") {
        const key = prompt ?? update.prompt_id ?? lineId(record);
        const payload = requestPayload(update, turn.model);
        delete turn.model;
        const durationMs = update.elapsed_ms;
        if (retain) {
          // The `request:<key>` id dedupe changes ids only: a repeated key still makes its own request.
          const requestId = `request:${key}`;
          const id = events.some((event) => event.id === requestId) ? `request:${lineId(record)}` : requestId;
          segment = placeRequest(
            events,
            segment,
            baseEvent(record, "request", payload, {
              id,
              ts,
              requestId: key
            })
          );
          if (durationMs !== undefined) {
            emit("system", { type: "turn_duration", durationMs });
          }
          // The window closes past the duration marker, so a later turn's request never reaches back before it.
          segment = events.length;
        } else {
          // Requests are placed in processing order, so the streaming pass sees the context shape for free.
          parts.push({ kind: "request", payload });
          if (durationMs !== undefined) {
            emit("system", { type: "turn_duration", durationMs });
          }
        }
        return { ok: true, parts };
      }

      if (kind === "hook_execution") {
        emit("hook", {
          type: "hook_execution",
          ...(update.event_name ? { event_name: update.event_name } : {}),
          ...(update.tool_name ? { tool_name: update.tool_name } : {}),
          runs: hookRuns(update.runs)
        });
        return { ok: true, parts };
      }

      if (kind === "auto_compact_started") {
        // A start has not replaced earlier context. Only `auto_compact_completed` does.
        noteSkip("compact-started");
        return { ok: true, parts };
      }
      if (kind === "auto_compact_completed") {
        const pre = update.tokens_before ?? update.tokens_used;
        const post = update.tokens_after;
        emit("compaction", {
          trigger: "auto",
          ...(pre === undefined ? {} : { preTokens: pre }),
          ...(post === undefined ? {} : { postTokens: post })
        });
        return { ok: true, parts };
      }

      if (kind === "compaction_checkpoint") {
        noteSkip("compaction-checkpoint");
        return { ok: true, parts };
      }

      if (kind === "subagent_spawned" || kind === "subagent_finished") {
        const agentId = update.subagent_id ?? update.child_session_id;
        const status = update.status;
        const durationMs = update.duration_ms;
        const part = emit("system", {
          type: kind,
          ...(agentId ? { agentId } : {}),
          ...(status ? { status } : {}),
          ...(durationMs === undefined ? {} : { durationMs })
        });
        // The log records the launch as `subagent_spawned`, not as a tool call.
        if (agentId) {
          rememberAgent(agentId, update.description, kind === "subagent_spawned" ? part.id : undefined);
        }
        return { ok: true, parts };
      }

      if (STATUS.has(kind)) {
        emit("system", {
          type: kind,
          ...(update.status ? { status: update.status } : {}),
          ...(update.phase ? { phase: update.phase } : {})
        });
        return { ok: true, parts };
      }

      if (BOOKKEEPING.has(kind)) {
        noteSkip(kind);
        return { ok: true, parts };
      }

      emit("unknown", { type: kind });
      return { ok: true, parts };
    }
  };
}
