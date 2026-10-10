import type { Capability } from "../index.js";
import type {
  SessionPromptsOptions,
  SessionPrompt,
  SessionSummary,
  SessionSummaryWithPrompts
} from "../../session/index.js";
import { mainAgentId, promptStarts, requestUsage } from "../policies/turns.js";
import type { Transcript } from "../value-objects/transcript.js";

const CONTEXT_SHAPE_POINTS = 120;

/** The capabilities whose absence leaves a summary number out. The others are counted regardless. */
export interface SummaryGates {
  readonly requests: boolean;
  readonly usage: boolean;
  readonly durations: boolean;
  readonly compaction: boolean;
  readonly subagents: boolean;
}

/**
 * The running numbers one summary pass keeps: `foldTranscript` fills them from a transcript's events, an adapter's
 * summarize pass from its records, and `finishTotals` applies the fold rules to both. Nothing here holds payload
 * text, and everything grows with requests and turns, never with bytes.
 */
export interface SummaryTotals {
  turns: number;
  requests: number;
  compactions: number;
  failedTools: number;
  /** The usage of each request in order; an entry whose counts the record left out stays empty. */
  usage: { inputTokens?: number; outputTokens?: number }[];
  /** The recorded turn durations and the request durations, as `durationMs` prefers them. */
  turnDurations: number[];
  requestDurations: number[];
}

/** Empty totals for one pass. */
export function emptyTotals(): SummaryTotals {
  return { turns: 0, requests: 0, compactions: 0, failedTools: 0, usage: [], turnDurations: [], requestDurations: [] };
}

/** Counts one request and its usage, which may record no count at all. */
export function addRequest(totals: SummaryTotals, usage: { inputTokens?: number; outputTokens?: number } = {}): void {
  totals.requests += 1;
  totals.usage.push(usage);
}

/** Counts a recorded turn duration. A duration that is not a number was never recorded. */
export function addTurnDuration(totals: SummaryTotals, durationMs: unknown): void {
  if (typeof durationMs === "number" && Number.isFinite(durationMs)) {
    totals.turnDurations.push(durationMs);
  }
}

/** Counts a request's own duration, the fallback `durationMs` uses when no turn names one. */
export function addRequestDuration(totals: SummaryTotals, durationMs: unknown): void {
  if (typeof durationMs === "number" && Number.isFinite(durationMs)) {
    totals.requestDurations.push(durationMs);
  }
}

/** The input tokens of each request in order, for the context shape. */
function inputPointsOf(totals: SummaryTotals): number[] {
  const points: number[] = [];
  for (const usage of totals.usage) {
    if (usage.inputTokens !== undefined) {
      points.push(usage.inputTokens);
    }
  }
  return points;
}

/** Input tokens of each request in order, downsampled to at most 120 points. */
export function downsampleContextShape(values: readonly number[]): number[] {
  if (values.length <= CONTEXT_SHAPE_POINTS) {
    return values.slice();
  }
  const last = values.length - 1;
  return Array.from(
    { length: CONTEXT_SHAPE_POINTS },
    (_, index) => values[Math.round((index * last) / (CONTEXT_SHAPE_POINTS - 1))]!
  );
}

function knownSum(values: readonly (number | undefined)[]): number | undefined {
  const known = values.filter((value): value is number => value !== undefined);
  return known.length > 0 ? known.reduce((total, value) => total + value, 0) : undefined;
}

function durationOf(totals: SummaryTotals): number | undefined {
  const known = (values: readonly number[]): number | undefined =>
    knownSum(values.map((value) => value as number | undefined));
  const turns = known(totals.turnDurations);
  if (turns !== undefined) {
    return turns;
  }
  return known(totals.requestDurations);
}

function gated(declared: boolean, value: number | undefined): number | undefined {
  return declared ? value : undefined;
}

/** The gates a summary's numbers sit behind, from the capabilities the source declares. */
export function summaryGates(capabilities: Iterable<Capability>): SummaryGates {
  const declared = capabilities instanceof Set ? capabilities : new Set(capabilities);
  return {
    requests: declared.has("requests"),
    usage: declared.has("usage"),
    durations: declared.has("durations"),
    compaction: declared.has("compaction"),
    subagents: declared.has("subagents")
  };
}

/** The prompts one summary pass collects under the caller's caps. */
export interface PromptSink {
  /** The collected prompts; `undefined` when the caller asked for none, like the summary's `prompts` field. */
  readonly list: SessionPrompt[] | undefined;
  /** Adds one prompt start's text: it lands while the collection is under `limit`, and only a non-empty string. */
  add(text: unknown): void;
}

/**
 * The sink a pass fills while it folds: the first `limit` non-empty texts of the main lane's prompt starts, each
 * sliced to `maxChars` — the rule `sessionPrompts` applies to a loaded transcript.
 */
export function emptyPrompts(options?: SessionPromptsOptions): PromptSink {
  const limit = options?.limit ?? 0;
  const maxChars = options?.maxChars ?? 0;
  const list = options === undefined ? undefined : ([] as SessionPrompt[]);
  return {
    list,
    add(text) {
      if (list !== undefined && list.length < limit && typeof text === "string" && text !== "") {
        list.push({ text: text.slice(0, maxChars) });
      }
    }
  };
}

/**
 * The SessionSummary of filled totals, under the gates the source declares: the same rules `foldTranscript`
 * states, so a fast pass and the folded transcript give the same numbers. `finishPass` and `foldTranscript` are
 * its only callers.
 */
function finishTotals(totals: SummaryTotals, gates: SummaryGates, subagents: number): SessionSummary {
  const inputPoints = inputPointsOf(totals);
  return {
    turns: totals.turns,
    requests: gated(gates.requests, totals.requests),
    inputTokens: gated(gates.usage, knownSum(totals.usage.map((usage) => usage.inputTokens))),
    outputTokens: gated(gates.usage, knownSum(totals.usage.map((usage) => usage.outputTokens))),
    durationMs: gated(gates.durations, durationOf(totals)),
    compactions: gated(gates.compaction, totals.compactions),
    subagents: gated(gates.subagents, subagents),
    failedTools: totals.failedTools,
    contextShape: gates.usage && inputPoints.length > 0 ? downsampleContextShape(inputPoints) : undefined
  };
}

/** A copy without the absent numbers, so summaries from different sources compare equal. */
export function summaryOf(summary: SessionSummary): SessionSummary {
  return Object.fromEntries(Object.entries(summary).filter(([, value]) => value !== undefined)) as SessionSummary;
}

/**
 * The summary of a finished pass: the fold rules over the totals behind the capabilities' gates, with the collected
 * prompts. The one assembly `foldTranscript` and the adapters' summarize passes share, so their numbers cannot
 * drift.
 */
export function finishPass(
  totals: SummaryTotals,
  capabilities: Iterable<Capability>,
  subagents: number,
  prompts: SessionPrompt[] | undefined
): SessionSummaryWithPrompts {
  const summary = summaryOf(finishTotals(totals, summaryGates(capabilities), subagents));
  return prompts === undefined ? summary : { ...summary, prompts };
}

/**
 * The SessionSummary of a transcript. A turn is one real prompt record on the main lane. Durations are the
 * recorded turn durations (`system` events with `type: 'turn_duration'`) when the agent records them, otherwise the
 * sum of request durations.
 */
export function foldTranscript(transcript: Transcript): SessionSummary {
  const totals = emptyTotals();
  for (const event of transcript.events) {
    if (event.kind === "request") {
      addRequest(totals, requestUsage(event));
      addRequestDuration(totals, event.payload.durationMs);
    } else if (event.kind === "compaction") {
      totals.compactions += 1;
    } else if (event.kind === "system" && event.payload.type === "turn_duration") {
      addTurnDuration(totals, event.payload.durationMs);
    } else if (event.kind === "tool_result" && event.payload.isError === true) {
      totals.failedTools += 1;
    }
  }
  totals.turns = promptStarts(transcript, mainAgentId(transcript)).length;
  return finishPass(
    totals,
    transcript.capabilities,
    transcript.agents.filter((agent) => agent.parentId !== undefined).length,
    undefined
  );
}
