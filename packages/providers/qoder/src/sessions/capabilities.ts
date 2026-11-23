import type { Capability } from "@rivus/agent-kit-sessions/spi";

/**
 * What Qoder CLI transcripts capture: requests with usage, reasoning blocks, compaction boundaries with the token
 * counts around them, subagents, and the `hook_*` attachments a hook leaves when it has output or fails. Qoder
 * records no turn durations, no system prompt and no tool schemas.
 */
export const QODER_CAPABILITIES: readonly Capability[] = [
  "requests",
  "usage",
  "reasoning",
  "compaction",
  "compactionTokens",
  "subagents",
  "hooks"
];
