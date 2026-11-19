import type { Capability } from "@rivus/agent-kit-sessions/spi";

/**
 * What Antigravity CLI transcripts capture: user/assistant messages, reasoning (`thinking`), tool calls and paired
 * tool results, per-step requests with model and token usage, and compaction checkpoints.
 */
export const AGY_CAPABILITIES: readonly Capability[] = ["requests", "usage", "reasoning", "compaction"];
