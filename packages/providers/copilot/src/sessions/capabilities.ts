import type { Capability } from "@rivus/agent-kit-sessions/spi";

/**
 * Everything GitHub Copilot CLI 1.0.114's `events.jsonl` captures: per-request model usage and durations
 * (`session.usage_record` and `session.compaction_complete`), reasoning text or redacted reasoning on
 * `assistant.message`, compaction checkpoints with pre/post context tokens, hook executions (`hook.start`/`hook.end`),
 * subagent lanes (`subagent.started` + envelope `agentId`), and system prompts (`system.message`). Tool schemas are
 * not persisted in `events.jsonl`.
 */
export const COPILOT_CAPABILITIES: readonly Capability[] = [
  "requests",
  "usage",
  "durations",
  "reasoning",
  "compaction",
  "compactionTokens",
  "hooks",
  "subagents",
  "systemPrompt"
];
