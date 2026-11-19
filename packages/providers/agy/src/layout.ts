import type { AgentHome } from "@rivus/agent-kit-catalog/spi";
import { joinPath } from "@rivus/agent-kit-sessions/spi";
import { AGY_BRAIN_DIR, AGY_TRANSCRIPT_FILE } from "./facts.js";

// Antigravity CLI writes per-conversation JSONL transcripts under
// `<home>/antigravity-cli/brain/<conversation-id>/.system_generated/logs/transcript.jsonl` (compact) and
// `transcript_full.jsonl` (untruncated). The conversation id is the directory three levels above the file.

export function agyRoots(home: AgentHome): string[] {
  return [joinPath(home.path, AGY_BRAIN_DIR)];
}

export function agySessionIdFromPath(path: string): string {
  const parts = path.split("/").filter((part) => part !== "");
  return parts.at(-4) ?? "unknown";
}

/** The walk for usage scans: matches only the compact `transcript.jsonl` so each conversation is counted once. */
export const AGY_TRANSCRIPT_FILES = {
  match: (name: string): boolean => name === AGY_TRANSCRIPT_FILE,
  maxDepth: 4
};
