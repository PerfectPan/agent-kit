import { err, ok, type Result } from "@rivus/agent-kit-catalog";

import {
  assignSeq,
  baseEvent,
  type Capability,
  inheritTimes,
  type Lane,
  lineId,
  MAIN_LANE_ID,
  markOrphanToolResults,
  type ParsedTranscript,
  placeRequest,
  type RequestPayload,
  shadowBefore,
  type SkippedRecord,
  skipRecord,
  type SourcedRecord,
  type TranscriptEvent,
  type TranscriptEventKind,
  type TranscriptSession,
  type UnknownFormatGeneration,
  unknownFormatGeneration
} from "../../domain/transcript/index.js";
import { asNumber, asRecord, asString } from "../record-fields.js";
import { chunkText, GROK_META_KEY, isInjectedChunk } from "./chunks.js";
import type { GrokSessionMeta, GrokSubagentMeta } from "./layout.js";
import { followGrokTurn, type GrokTurn, grokTurnModel, grokUsage, grokUsageByModel, knownGrokUpdate } from "./usage.js";

const AGENT = "grok";

/** Recorded by every Grok session. */
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
 * Everything a Grok transcript can list. `systemPrompt` and `toolSchemas` come from optional files beside
 * `updates.jsonl`, so a transcript lists them only when that session directory has them.
 */
export const GROK_CAPABILITIES: readonly Capability[] = [...BASE_CAPABILITIES, "systemPrompt", "toolSchemas"];

/** The capabilities one translated transcript shows. */
export function grokCapabilities(
  session: Pick<TranscriptSession, "systemPrompt" | "tools">,
  agents: readonly Pick<Lane, "systemPrompt">[]
): Capability[] {
  const out: Capability[] = [...BASE_CAPABILITIES];
  if (session.systemPrompt || agents.some((agent) => agent.systemPrompt)) {
    out.push("systemPrompt");
  }
  if (session.tools !== undefined) {
    out.push("toolSchemas");
  }
  return out;
}

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

export interface GrokTranslateOptions {
  /** Wins over the summary id when the summary names none. */
  sessionId?: string;
  meta?: GrokSessionMeta;
  /** `meta.json` of each `<session>/subagents/<id>/` directory, keyed by the directory name. */
  subagents?: ReadonlyMap<string, GrokSubagentMeta>;
}

/**
 * Translates one session's `updates.jsonl` records into transcript events. Grok records usage only per turn
 * (`turn_completed.usage` sums that turn's model calls), so each `request` is one turn: `granularity` is `turn`,
 * `modelCalls` is the count, and `usageByModel` is the per-model split. The request is placed before the turn's
 * first output. `elapsed_ms` is the turn duration and stays on a `turn_duration` marker.
 */
export function translateGrokRecords(
  records: readonly SourcedRecord[],
  options: GrokTranslateOptions = {}
): Result<ParsedTranscript, UnknownFormatGeneration> {
  const meta = options.meta ?? {};
  const events: TranscriptEvent[] = [];
  const skipped: SkippedRecord[] = [];
  const agents: Lane[] = [{ id: MAIN_LANE_ID }];
  const times = inheritTimes(records);
  const turn: GrokTurn = {};
  let lastUserPrompt: string | undefined;
  let startedAt = meta.startedAt;
  let endedAt = meta.endedAt;
  let segment = 0;
  const tools = new Map<string, ToolState>();

  const rememberAgent = (id: string, title?: string, spawnEventId?: string): void => {
    const existing = agents.find((agent) => agent.id === id);
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

  for (let index = 0; index < records.length; index++) {
    const record = records[index]!;
    const ts = times[index]!;
    const update = knownGrokUpdate(record.value);
    if (!update) {
      return err(unknownFormatGeneration(AGENT, record));
    }

    const kind = asString(update.sessionUpdate) ?? "update";
    startedAt = Math.min(startedAt ?? ts, ts);
    endedAt = Math.max(endedAt ?? ts, ts);
    const updateMeta = asRecord(update[GROK_META_KEY]);
    followGrokTurn(turn, update);
    const prompt = turn.prompt;

    const emit = (eventKind: TranscriptEventKind, payload: Record<string, unknown>, id?: string): TranscriptEvent => {
      const event = baseEvent(record, eventKind, payload, { id: id ?? lineId(record), ts });
      events.push(event);
      return event;
    };

    if (kind === "user_message_chunk" || kind === "agent_message_chunk" || kind === "agent_thought_chunk") {
      const text = chunkText(update.content);
      if (kind !== "user_message_chunk") {
        emit(kind === "agent_thought_chunk" ? "reasoning" : "assistant", text ? { text } : {});
        continue;
      }
      const flags: Record<string, unknown> = {};
      if (isInjectedChunk(updateMeta, text)) {
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
      continue;
    }

    if (kind === "tool_call" || kind === "tool_call_update") {
      recordTool(kind, update, record, tools, skipped, emit);
      continue;
    }

    if (kind === "turn_completed") {
      const key = prompt ?? asString(update.prompt_id) ?? lineId(record);
      const requestId = `request:${key}`;
      const id = events.some((event) => event.id === requestId) ? `request:${lineId(record)}` : requestId;
      segment = placeRequest(
        events,
        segment,
        baseEvent(record, "request", requestPayload(update, grokTurnModel(update, turn.model)), {
          id,
          ts,
          requestId: key
        })
      );
      delete turn.model;
      const durationMs = asNumber(update.elapsed_ms);
      if (durationMs !== undefined) {
        emit("system", { type: "turn_duration", durationMs });
      }
      segment = events.length;
      continue;
    }

    if (kind === "hook_execution") {
      const eventName = asString(update.event_name);
      const toolName = asString(update.tool_name);
      emit("hook", {
        type: "hook_execution",
        ...(eventName ? { event_name: eventName } : {}),
        ...(toolName ? { tool_name: toolName } : {}),
        runs: hookRuns(update.runs)
      });
      continue;
    }

    if (kind === "auto_compact_started") {
      // A start has not replaced earlier context. Only `auto_compact_completed` does.
      skipRecord(skipped, record, "compact-started");
      continue;
    }
    if (kind === "auto_compact_completed") {
      const pre = asNumber(update.tokens_before ?? update.tokens_used);
      const post = asNumber(update.tokens_after);
      emit("compaction", {
        trigger: "auto",
        ...(pre === undefined ? {} : { preTokens: pre }),
        ...(post === undefined ? {} : { postTokens: post })
      });
      continue;
    }

    if (kind === "compaction_checkpoint") {
      skipRecord(skipped, record, "compaction-checkpoint");
      continue;
    }

    if (kind === "subagent_spawned" || kind === "subagent_finished") {
      const agentId = asString(update.subagent_id) ?? asString(update.child_session_id);
      const status = asString(update.status);
      const durationMs = asNumber(update.duration_ms);
      const event = emit("system", {
        type: kind,
        ...(agentId ? { agentId } : {}),
        ...(status ? { status } : {}),
        ...(durationMs === undefined ? {} : { durationMs })
      });
      // The log records the launch as `subagent_spawned`, not as a tool call.
      if (agentId) {
        rememberAgent(agentId, asString(update.description), kind === "subagent_spawned" ? event.id : undefined);
      }
      continue;
    }

    if (STATUS.has(kind)) {
      const status = asString(update.status);
      const phase = asString(update.phase);
      emit("system", { type: kind, ...(status ? { status } : {}), ...(phase ? { phase } : {}) });
      continue;
    }

    if (BOOKKEEPING.has(kind)) {
      skipRecord(skipped, record, kind);
      continue;
    }

    emit("unknown", { type: kind });
  }

  for (const compaction of events) {
    if (compaction.kind === "compaction") {
      shadowBefore(events, compaction);
    }
  }
  applySubagents(agents, options.subagents);
  markOrphanToolResults(events);
  assignSeq(events);

  const session: TranscriptSession = {
    id: meta.id ?? options.sessionId ?? "unknown",
    ...(meta.title ? { title: meta.title } : {}),
    ...(meta.cwd ? { cwd: meta.cwd } : {}),
    ...(startedAt === undefined ? {} : { startedAt }),
    ...(endedAt === undefined ? {} : { endedAt }),
    ...(meta.systemPrompt ? { systemPrompt: meta.systemPrompt } : {}),
    ...(meta.tools === undefined ? {} : { tools: meta.tools })
  };
  return ok({ events, skipped, session, agents });
}

function applySubagents(agents: Lane[], subagents: ReadonlyMap<string, GrokSubagentMeta> | undefined): void {
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

/** A `request` for one turn. Grok's cost (`costUsdTicks`) stays on the original record; `decodeUsage` reports it. */
function requestPayload(update: Record<string, unknown>, model: string | undefined): Record<string, unknown> {
  const usageRaw = asRecord(update.usage);
  const usage = grokUsage(usageRaw);
  const finishReason = asString(update.stop_reason);
  const modelCalls = asNumber(usageRaw?.modelCalls);
  const byModel = grokUsageByModel(usageRaw?.modelUsage);
  // `baseEvent` stores a record. `satisfies` keeps the fields on `RequestPayload`.
  return {
    granularity: "turn",
    ...(model ? { model } : {}),
    ...(usage ? { usage } : {}),
    ...(finishReason ? { finishReason } : {}),
    ...(modelCalls === undefined ? {} : { modelCalls }),
    ...(byModel ? { usageByModel: byModel } : {})
  } satisfies RequestPayload;
}

function hookRuns(runs: unknown): Record<string, unknown>[] {
  if (!Array.isArray(runs)) {
    return [];
  }
  return runs.flatMap((item) => {
    const run = asRecord(item);
    if (!run) {
      return [];
    }
    const status = asRecord(run.status);
    const body: Record<string, unknown> = {};
    const name = asString(run.name);
    const state = asString(status?.status);
    const elapsedMs = asNumber(status?.elapsed_ms);
    const exitCode = asNumber(run.exit_code ?? status?.exit_code);
    const output = asString(run.output ?? status?.output);
    if (name) {
      body.name = name;
    }
    if (state) {
      body.status = state;
    }
    if (elapsedMs !== undefined) {
      body.elapsedMs = elapsedMs;
    }
    if (exitCode !== undefined) {
      body.exitCode = exitCode;
    }
    if (output) {
      body.output = output;
    }
    return [body];
  });
}

interface ToolState {
  callId: string;
  name: string;
  args?: unknown;
  output?: unknown;
  status?: string;
  call?: TranscriptEvent;
  result?: TranscriptEvent;
}

const TOOL_DONE = new Set(["completed", "failed", "error"]);

/**
 * Merges `tool_call` and `tool_call_update` rows that share a `toolCallId`. An ACP update may carry only the
 * fields that changed. Only an omitted or `null` `rawInput`, `content` or `rawOutput` leaves the previous value.
 */
function recordTool(
  kind: string,
  update: Record<string, unknown>,
  record: SourcedRecord,
  tools: Map<string, ToolState>,
  skipped: SkippedRecord[],
  emit: (eventKind: TranscriptEventKind, payload: Record<string, unknown>, id?: string) => TranscriptEvent
): void {
  const callId = asString(update.toolCallId) ?? "";
  const state = tools.get(callId) ?? { callId, name: "" };
  tools.set(callId, state);
  mergeTool(state, update);
  if (kind === "tool_call") {
    if (state.call) {
      writeToolCall(state.call, state);
      skipRecord(skipped, record, "tool-progress");
      return;
    }
    state.call = emit("tool_call", toolCallPayload(state));
    return;
  }
  if (state.call) {
    writeToolCall(state.call, state);
  }
  if (!state.status || !TOOL_DONE.has(state.status)) {
    skipRecord(skipped, record, "tool-progress");
    return;
  }
  // A result with no earlier call stays an orphan. Inventing the call would hide that.
  if (!state.result) {
    state.result = emit("tool_result", toolResultPayload(state));
    return;
  }
  writeToolResult(state.result, state);
  skipRecord(skipped, record, "tool-progress");
}

function mergeTool(state: ToolState, update: Record<string, unknown>): void {
  const name = asString(update.title) ?? asString(update.toolName);
  if (name) {
    state.name = name;
  }
  if (supplied(update.rawInput)) {
    state.args = update.rawInput;
  }
  if (supplied(update.content)) {
    const text = chunkText(update.content);
    state.output = text.length > 0 ? text : update.content;
  } else if (supplied(update.rawOutput)) {
    state.output = update.rawOutput;
  }
  const status = asString(update.status);
  if (status) {
    state.status = status;
  }
}

/** `undefined` and `null` are omissions. Every other value, including `""`, `[]` and `{}`, replaces the field. */
function supplied(value: unknown): boolean {
  return value !== undefined && value !== null;
}

function toolCallPayload(state: ToolState): Record<string, unknown> {
  return {
    callId: state.callId,
    name: state.name,
    ...(state.args === undefined ? {} : { args: state.args })
  };
}

function toolResultPayload(state: ToolState): Record<string, unknown> {
  return {
    callId: state.callId,
    isError: state.status !== "completed",
    ...(state.output === undefined ? {} : { output: state.output })
  };
}

function writeToolCall(event: TranscriptEvent, state: ToolState): void {
  event.payload.callId = state.callId;
  event.payload.name = state.name;
  if (state.args !== undefined) {
    event.payload.args = state.args;
  }
}

function writeToolResult(event: TranscriptEvent, state: ToolState): void {
  event.payload.callId = state.callId;
  event.payload.isError = state.status !== "completed";
  if (state.output !== undefined) {
    event.payload.output = state.output;
  }
}
