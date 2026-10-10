import type { SessionSummary } from "../../session/index.js";
import { mainAgentId, promptStarts, requestUsage } from "../policies/turns.js";
import type { TranscriptEvent } from "../value-objects/transcript-event.js";
import type { Transcript } from "../value-objects/transcript.js";

const CONTEXT_SHAPE_POINTS = 120;

function gated(declared: boolean, value: number | undefined): number | undefined {
  return declared ? value : undefined;
}

function knownSum(values: readonly (number | undefined)[]): number | undefined {
  const known = values.filter((value): value is number => value !== undefined);
  return known.length > 0 ? known.reduce((total, value) => total + value, 0) : undefined;
}

function finite(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function durationSum(events: readonly TranscriptEvent[]): number | undefined {
  const turns = knownSum(
    events
      .filter((event) => event.kind === "system" && event.payload.type === "turn_duration")
      .map((event) => finite(event.payload.durationMs))
  );
  if (turns !== undefined) {
    return turns;
  }
  return knownSum(events.filter((event) => event.kind === "request").map((event) => finite(event.payload.durationMs)));
}

function downsample(values: readonly number[], max: number): number[] {
  if (values.length <= max) {
    return values.slice();
  }
  const last = values.length - 1;
  return Array.from({ length: max }, (_, index) => values[Math.round((index * last) / (max - 1))]!);
}

/** A copy without the absent numbers, so summaries from different sources compare equal. */
export function summaryOf(summary: SessionSummary): SessionSummary {
  return Object.fromEntries(Object.entries(summary).filter(([, value]) => value !== undefined)) as SessionSummary;
}

/**
 * The SessionSummary of a transcript. A turn is one real prompt record on the main lane. Durations are the
 * recorded turn durations (`system` events with `type: 'turn_duration'`) when the agent records them, otherwise the
 * sum of request durations.
 */
export function foldTranscript(transcript: Transcript): SessionSummary {
  const capabilities = new Set(transcript.capabilities);
  const requests = transcript.events.filter((event) => event.kind === "request");
  const usage = capabilities.has("usage");
  const inputPoints = requests.flatMap((event) => {
    const input = requestUsage(event).inputTokens;
    return input === undefined ? [] : [input];
  });
  return summaryOf({
    turns: promptStarts(transcript, mainAgentId(transcript)).length,
    requests: gated(capabilities.has("requests"), requests.length),
    inputTokens: gated(usage, knownSum(requests.map((event) => requestUsage(event).inputTokens))),
    outputTokens: gated(usage, knownSum(requests.map((event) => requestUsage(event).outputTokens))),
    durationMs: gated(capabilities.has("durations"), durationSum(transcript.events)),
    compactions: gated(
      capabilities.has("compaction"),
      transcript.events.filter((event) => event.kind === "compaction").length
    ),
    subagents: gated(
      capabilities.has("subagents"),
      transcript.agents.filter((agent) => agent.parentId !== undefined).length
    ),
    failedTools: transcript.events.filter((event) => event.kind === "tool_result" && event.payload.isError === true)
      .length,
    contextShape: usage && inputPoints.length > 0 ? downsample(inputPoints, CONTEXT_SHAPE_POINTS) : undefined
  });
}
