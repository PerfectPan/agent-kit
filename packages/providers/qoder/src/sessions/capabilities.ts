import type { Capability } from "@rivus/agent-kit-sessions/spi";

/** What Qoder CLI transcripts capture: requests with usage, reasoning blocks, compaction boundaries, and subagents. */
export const QODER_CAPABILITIES: readonly Capability[] = ["requests", "usage", "reasoning", "compaction", "subagents"];
