import type { Capability } from "@rivus/agent-kit-sessions/spi";

/**
 * What Kimi Code transcripts can list. The wire records user and assistant text, tool calls and results, per-step
 * requests with usage and turn durations, and the bound profile's system prompt; reasoning parts and compaction
 * summaries are not captured as their own record types on the verified protocol.
 */
export const KIMI_CAPABILITIES: readonly Capability[] = [
  "requests",
  "usage",
  "durations",
  "systemPrompt",
  "toolSchemas"
];
