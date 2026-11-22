import type { Capability, TranscriptEvent, TranscriptSession } from "@rivus/agent-kit-sessions/spi";
import { latestSnapshot, snapshotHasSystemPrompt, snapshotHasTools } from "@rivus/agent-kit-sessions/spi";

/**
 * What every Kimi Code transcript can list: the wire records user and assistant text, reasoning (`think`) parts,
 * tool calls and results, per-step requests with usage, turn durations, the bound profile's system prompt, tool
 * snapshots, `context.apply_compaction` boundaries and the subagent lanes' wires.
 */
const KIMI_BASE_CAPABILITIES: readonly Capability[] = [
  "requests",
  "usage",
  "durations",
  "reasoning",
  "compaction",
  "subagents"
];

/**
 * Everything a Kimi transcript can list. The profile's system prompt and the tools snapshot ride their records, so a
 * transcript lists them only when it holds them; hooks are the `hook_result` messages a configured hook appended, and
 * `compactionTokens` the before/after counts an apply-compaction record carries.
 */
export const KIMI_CAPABILITIES: readonly Capability[] = [
  ...KIMI_BASE_CAPABILITIES,
  "compactionTokens",
  "hooks",
  "systemPrompt",
  "toolSchemas"
];

/** The capabilities one translated transcript shows. */
export function kimiCapabilities(session: TranscriptSession, events: readonly TranscriptEvent[]): Capability[] {
  let hasHooks = false;
  let hasCompactionTokens = false;
  for (const event of events) {
    if (event.kind === "hook") {
      hasHooks = true;
    } else if (
      event.kind === "compaction" &&
      (event.payload.preTokens !== undefined || event.payload.postTokens !== undefined)
    ) {
      hasCompactionTokens = true;
    }
  }
  const optional: Capability[] = [];
  if (hasCompactionTokens) {
    optional.push("compactionTokens");
  }
  if (hasHooks) {
    optional.push("hooks");
  }
  if (session.systemPrompt !== undefined || latestSnapshot(events, snapshotHasSystemPrompt) !== undefined) {
    optional.push("systemPrompt");
  }
  if (session.tools !== undefined || latestSnapshot(events, snapshotHasTools) !== undefined) {
    optional.push("toolSchemas");
  }
  return [...KIMI_BASE_CAPABILITIES, ...optional];
}
