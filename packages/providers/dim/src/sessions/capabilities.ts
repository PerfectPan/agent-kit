import { detectEventCapabilities, type Capability, type TranscriptEvent } from "@rivus/agent-kit-sessions/spi";

/**
 * Everything a DimCode session's rows can show. `hooks`, `systemPrompt` and `toolSchemas` are not among them: the
 * store keeps no hook run, and the system prompt and the toolset are assembled per run and saved only by the opt-in
 * observability trace (`dim exec --trace=<absolute dir>`, or `agentTraceDir` in `config.json`), outside the
 * session store.
 */
export const DIM_SESSION_CAPABILITIES: readonly Capability[] = [
  "requests",
  "usage",
  "durations",
  "reasoning",
  "compaction",
  "compactionTokens",
  "subagents"
];

/** The capabilities the events of one transcript and its subagent lanes show, in the adapter's order. */
export function dimCapabilities(events: readonly TranscriptEvent[], subagents: number): Capability[] {
  const detected = new Set<Capability>(detectEventCapabilities(events));
  const hasDuration = events.some((event) => event.kind === "request" && event.payload.durationMs !== undefined);
  return DIM_SESSION_CAPABILITIES.filter(
    (capability) =>
      detected.has(capability) ||
      (capability === "durations" && hasDuration) ||
      (capability === "subagents" && subagents > 0)
  );
}
