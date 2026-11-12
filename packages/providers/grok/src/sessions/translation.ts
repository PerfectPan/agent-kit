import {
  baseEvent,
  type Lane,
  lineId,
  MAIN_LANE_ID,
  type MessagePayload,
  OUTPUT_KINDS,
  placeRequest,
  type RequestPayload,
  type SourcedRecord,
  type TranscriptEvent,
  type TranscriptEventBody,
  type TranscriptEventOf,
  acpChunkText,
  acpMessageKind,
  acpToolCallPayload,
  acpToolResultPayload,
  type AcpToolState,
  isAcpToolDone,
  isAcpToolError,
  mergeAcpToolStatus,
  mergeAcpToolUpdate
} from "@rivus/agent-kit-sessions/spi";
import { definedFields } from "@rivus/agent-kit-catalog/spi";
import { isInjectedChunk } from "./chunks.js";
import { type GrokCall, type GrokSessionCalls } from "./calls.js";
import { type GrokSubagentMeta } from "../layout.js";
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
} from "../records.js";

/** Record types that only the Grok CLI reads. Each becomes a skipped record with its type as the reason. */
const BOOKKEEPING = new Set([
  "background_tasks",
  "task_backgrounded",
  "task_completed",
  "session_recap",
  "retry_state",
  "plan",
  "image_compressed"
]);

/** Status updates of the Grok CLI, kept as `system` events with their `type`. */
const STATUS = new Set(["goal_updated", "memory_dream_queued", "memory_dream_started", "memory_dream_completed"]);

/** A `request` for one turn. Grok's cost (`costUsdTicks`) stays on the original record; `decodeUsage` reports it. */
function requestPayload(update: GrokUpdateValue, turnModel: string | undefined): RequestPayload {
  const raw = grokTurnUsage(update);
  const usage = grokUsageOf(raw);
  const model = grokTurnModel(raw?.modelUsage, turnModel);
  const byModel = grokUsageByModel(raw?.modelUsage);
  return {
    granularity: "turn",
    ...(model ? { model } : {}),
    ...(usage ? { usage } : {}),
    ...(update.stop_reason ? { finishReason: update.stop_reason } : {}),
    ...(raw?.modelCalls === undefined ? {} : { modelCalls: raw.modelCalls }),
    ...(byModel ? { usageByModel: byModel } : {})
  };
}

/** The calls of the turn the prompt index names, or none when the join is absent or the turn names no index. */
function turnCalls(calls: GrokSessionCalls | undefined, prompt: string | undefined): readonly GrokCall[] {
  if (calls === undefined || prompt === undefined) {
    return [];
  }
  const index = Number(prompt);
  return Number.isInteger(index) ? (calls.turns.get(index) ?? []) : [];
}

/** The payload of one model call: its model and no usage, since Grok logs usage per turn, never per call. */
function callRequestPayload(call: GrokCall): RequestPayload {
  return definedFields({ granularity: "request" as const, model: call.model });
}

/**
 * The request payloads of a turn the join names several calls for, in call order. The last call carries the turn's
 * aggregate whole (`granularity: "turn"`, its usage, `modelCalls` and per-model split, and the turn's model, which
 * names the usage like the scan's turn record does): the turn ends with that call, and the aggregate is no model
 * call of its own, so `requests` counts the calls the join names.
 */
function callPayloads(calls: readonly GrokCall[], aggregate: RequestPayload): RequestPayload[] {
  return calls.map((call, index) => {
    if (index < calls.length - 1) {
      return callRequestPayload(call);
    }
    return aggregate.model === undefined && call.model !== undefined ? { ...aggregate, model: call.model } : aggregate;
  });
}

/**
 * The index of the first output of each call among `events[from..]`, by structure rather than time: `updates.jsonl`
 * stamps whole seconds, which cannot order a call's first output against the `first_token` of the call before. A
 * tool call the join names belongs to its call. Any other output after a tool result begins the next call once the
 * current one has made every tool call its loop completed (a response may stream a tool call after an earlier one's
 * result); a call whose loop the join lacks ends at its first result. Calls never go back, outputs past the last call
 * stay with it, and a call no output reached has no start.
 */
function callStarts(
  events: readonly TranscriptEvent[],
  from: number,
  calls: readonly GrokCall[]
): (number | undefined)[] {
  const owners = new Map<string, number>();
  calls.forEach((call, index) => {
    for (const id of call.toolCallIds ?? []) {
      owners.set(id, index);
    }
  });
  const starts: (number | undefined)[] = calls.map(() => undefined);
  let call = -1;
  let toolCalls = 0;
  let resulted = false;
  for (let index = from; index < events.length; index++) {
    const event = events[index]!;
    if (event.kind === "tool_result") {
      resulted = true;
      continue;
    }
    if (!OUTPUT_KINDS.has(event.kind)) {
      continue;
    }
    const owner = event.kind === "tool_call" ? owners.get(event.payload.callId) : undefined;
    const done = call >= 0 && toolCalls >= (calls[call]!.toolCallIds?.length ?? 0);
    let next = call;
    if (owner !== undefined) {
      next = Math.max(call, owner);
    } else if (call === -1 || (resulted && done)) {
      next = call + 1;
    }
    next = Math.min(next, calls.length - 1);
    if (next !== call) {
      call = next;
      starts[call] = index;
      toolCalls = 0;
    }
    if (event.kind === "tool_call") {
      toolCalls += 1;
    }
    resulted = false;
  }
  return starts;
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

function hookExitCode(runs: readonly (GrokHookRunValue | undefined)[] | undefined): number | undefined {
  let allSucceeded = runs !== undefined && runs.length > 0;
  for (const run of runs ?? []) {
    const exitCode = run?.exit_code ?? run?.status?.exit_code;
    if (exitCode === undefined) {
      allSucceeded = false;
    } else if (exitCode !== 0) {
      return exitCode;
    }
  }
  return allSucceeded ? 0 : undefined;
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

/**
 * One event a record emitted, with its event id: present with retain, where the parts are the emitted
 * `TranscriptEvent`s themselves, and absent in the bounded pass, which reads no ids.
 */
export type GrokPart = TranscriptEventBody & { id?: string };

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
  call?: TranscriptEventOf<"tool_call">;
  result?: TranscriptEventOf<"tool_result">;
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
  /**
   * Steps one record. `ts` is the record's inherited time, which the retain mode stamps its events with; the
   * bounded pass reads no times and omits it.
   */
  step(record: SourcedRecord, ts?: number): GrokStep;
}

/** The translation the retain path steps: every record carries the time `inheritTimes` gave it. */
export interface RetainGrokTranslation extends GrokTranslation {
  /** Steps one record, stamping its events with the record's inherited time. */
  step(record: SourcedRecord, ts: number): GrokStep;
}

/** The translation the bounded pass steps: it reads no times, so its steps take none. */
export interface BoundedGrokTranslation extends GrokTranslation {
  /** Steps one record; the bounded pass emits no timed events. */
  step(record: SourcedRecord): GrokStep;
}

export interface GrokTranslationOptions {
  readonly retain: boolean;
  /**
   * The per-turn model calls joined from `events.jsonl` and `chat_history.jsonl`. A turn the join names more
   * than one call for emits one request per call, the last carrying the turn's aggregate usage; without the join,
   * or for a single-call turn, the translation keeps its turn-level request. Both modes read the same join, so the
   * bounded pass counts the requests the retained one places.
   */
  readonly calls?: GrokSessionCalls;
}

export function createGrokTranslation(
  options: GrokTranslationOptions & { readonly retain: true }
): RetainGrokTranslation;
export function createGrokTranslation(
  options: GrokTranslationOptions & { readonly retain: false }
): BoundedGrokTranslation;
export function createGrokTranslation(options: GrokTranslationOptions): GrokTranslation;
export function createGrokTranslation(options: GrokTranslationOptions): GrokTranslation {
  const retain = options.retain;
  const events: TranscriptEvent[] = [];
  const skips: GrokSkip[] = [];
  const agents: Lane[] = [{ id: MAIN_LANE_ID }];
  const tools = new Map<string, AcpToolState>();
  /** The slim mirror of `tools`: a call id and its status, with no args or output text. */
  const statuses = new Map<string, AcpToolState>();
  const toolEvents = new Map<string, ToolEvents>();
  const toolResults = new Map<string, boolean>();
  /** The ids the retained events hold, so a request id one already holds moves to the next free serial. */
  const usedIds = new Set<string>();
  const turn: GrokTurn = {};
  let lastUserPrompt: string | undefined;
  let segment = 0;
  /** The prompts whose calls got their own requests, so a repeated `turn_completed` places them only once. */
  const callTurns = new Set<string>();

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

  /**
   * The first id of `base`'s shape no event holds: `base` itself, then `base:1`, `base:2`, …. The pattern
   * guarantees nothing by itself, so the check at emission is what keeps ids apart.
   */
  const nextFree = (base: string): string => {
    let candidate = base;
    for (let serial = 1; usedIds.has(candidate); serial += 1) {
      candidate = `${base}:${serial}`;
    }
    return candidate;
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
      /** The retain emit: the `TranscriptEvent` itself, pushed to the sequence and to this record's parts. */
      const pushEvent = <E extends TranscriptEvent>(event: E): E => {
        events.push(event);
        parts.push(event);
        usedIds.add(event.id);
        return event;
      };
      /** The mode's emit: the event with retain, a light part without. */
      const emit = (body: TranscriptEventBody): GrokPart => {
        if (!retain) {
          parts.push(body);
          return body;
        }
        return pushEvent(baseEvent(record, body.kind, body.payload, { id: lineId(record), ts }));
      };

      followGrokTurn(turn, update);
      const prompt = turn.prompt;

      const messageKind = acpMessageKind(kind);
      if (messageKind !== undefined) {
        const text = acpChunkText(update.content);
        if (messageKind !== "user") {
          emit({ kind: messageKind, payload: text ? { text } : {} });
          return { ok: true, parts };
        }
        const flags: Pick<MessagePayload, "injected" | "continued"> = {};
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
        emit({ kind: "user", payload: { ...flags, ...(text ? { text } : {}) } });
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
            seen.call = pushEvent(
              baseEvent(record, "tool_call", acpToolCallPayload(state), { id: lineId(record), ts })
            );
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
            seen.result = pushEvent(
              baseEvent(record, "tool_result", acpToolResultPayload(state), { id: lineId(record), ts })
            );
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
        // A turn's calls are placed once: a repeated `turn_completed` for the same prompt has no calls of its own
        // left to show, so it keeps the turn-level request, in both modes alike.
        const calls = prompt === undefined || callTurns.has(prompt) ? [] : turnCalls(options.calls, prompt);
        const payloads = calls.length > 1 ? callPayloads(calls, payload) : [payload];
        if (prompt !== undefined && calls.length > 1) {
          callTurns.add(prompt);
        }
        if (retain && payloads.length > 1) {
          // One request per model call, before the call's first output, with the turn's events from `segment` on
          // stamped as the members of the call they follow (the prompt and anything before the first output join
          // the first call). A call no output reached sits just before the next call's request, or at the end.
          const callRequests = calls.map((call, index) => {
            const requestId = `${key}#${index}`;
            const id = nextFree(`request:${requestId}`);
            usedIds.add(id);
            return baseEvent(record, "request", payloads[index]!, { id, ts: call.ts ?? ts, requestId });
          });
          const starts = callStarts(events, segment, calls);
          let tail = events.length;
          for (let call = calls.length - 1; call >= 0; call--) {
            const at = Math.min(starts[call] ?? tail, tail);
            const request = callRequests[call]!;
            // The response start, but never after the output it precedes: `updates.jsonl` may stamp that output
            // with the whole second the `first_token` falls in.
            if (at < events.length && request.ts > events[at]!.ts) {
              request.ts = events[at]!.ts;
            }
            events.splice(at, 0, request);
            tail = at;
          }
          let member: string | undefined = callRequests[0]!.requestId;
          for (let index = segment; index < events.length; index++) {
            const event = events[index]!;
            if (event.kind === "request") {
              member = event.requestId;
            } else if (event.requestId === undefined) {
              event.requestId = member;
            }
          }
        } else if (retain) {
          // The `request:<key>` id dedupe changes ids only: a repeated key still makes its own request. Event ids
          // stay unique because every id is taken only while `usedIds` does not hold it: the request keeps
          // `request:<key>` when free, else the first free serial of `request:<line>` — the fallback a taken key
          // already used, now checked like the Codex translator checks its own.
          const requestId = `request:${key}`;
          const id = usedIds.has(requestId) ? nextFree(`request:${lineId(record)}`) : requestId;
          usedIds.add(id);
          placeRequest(
            events,
            segment,
            baseEvent(record, "request", payload, {
              id,
              ts,
              requestId: key
            })
          );
        } else {
          // Requests are placed in processing order, so the streaming pass sees the context shape for free: the
          // call requests in call order, the last carrying the aggregate, as the retained placement orders them.
          for (const each of payloads) {
            parts.push({ kind: "request", payload: each });
          }
        }
        if (durationMs !== undefined) {
          emit({ kind: "system", payload: { type: "turn_duration", durationMs } });
        }
        // The window closes past the duration marker, so a later turn's request never reaches back before it.
        segment = events.length;
        return { ok: true, parts };
      }

      if (kind === "hook_execution") {
        const exitCode = hookExitCode(update.runs);
        emit({
          kind: "hook",
          payload: {
            type: "hook_execution",
            ...(update.event_name ? { event: update.event_name } : {}),
            ...(update.tool_name ? { name: update.tool_name } : {}),
            ...(exitCode === undefined ? {} : { exitCode }),
            runs: hookRuns(update.runs)
          }
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
        emit({
          kind: "compaction",
          payload: {
            trigger: "auto",
            ...(pre === undefined ? {} : { preTokens: pre }),
            ...(post === undefined ? {} : { postTokens: post })
          }
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
        const part = emit({
          kind: "system",
          payload: {
            type: kind,
            ...(agentId ? { agentId } : {}),
            ...(status ? { status } : {}),
            ...(durationMs === undefined ? {} : { durationMs })
          }
        });
        // The log records the launch as `subagent_spawned`, not as a tool call.
        if (agentId) {
          rememberAgent(agentId, update.description, kind === "subagent_spawned" ? part.id : undefined);
        }
        return { ok: true, parts };
      }

      if (STATUS.has(kind)) {
        emit({
          kind: "system",
          payload: {
            type: kind,
            ...(update.status ? { status: update.status } : {}),
            ...(update.phase ? { phase: update.phase } : {})
          }
        });
        return { ok: true, parts };
      }

      if (BOOKKEEPING.has(kind)) {
        noteSkip(kind);
        return { ok: true, parts };
      }

      emit({ kind: "unknown", payload: { type: kind } });
      return { ok: true, parts };
    }
  };
}
