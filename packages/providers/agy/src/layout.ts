import type { AgentHome } from "@rivus/agent-kit-catalog/spi";
import { joinPath } from "@rivus/agent-kit-sessions/spi";
import { AGY_BRAIN_DIR, AGY_TRANSCRIPT_FILE, AGY_TRANSCRIPT_FULL_REL, AGY_TRANSCRIPT_REL } from "./facts.js";

// Antigravity CLI writes per-conversation JSONL transcripts under
// `<home>/antigravity-cli/brain/<conversation-id>/.system_generated/logs/transcript.jsonl` (compact) and
// `transcript_full.jsonl` (untruncated). The conversation id is the directory three levels above the file.

export function agyRoots(home: AgentHome): string[] {
  return [joinPath(home.path, AGY_BRAIN_DIR)];
}

export function agySessionIdFromPath(path: string): string {
  const parts = path.split(/[/\\]/).filter((part) => part !== "");
  return parts.at(-4) ?? "unknown";
}

/**
 * The brain root a transcript path sits under and the conversation it belongs to, on either separator; `undefined`
 * for a path outside the layout. A subagent conversation's transcript is the same layout under the same brain root.
 */
export function agyConversationLocation(
  path: string
): { readonly brainRoot: string; readonly conversationId: string } | undefined {
  const normalized = path.replaceAll("\\", "/");
  const transcript = [AGY_TRANSCRIPT_FULL_REL, AGY_TRANSCRIPT_REL].find((rel) => normalized.endsWith(`/${rel}`));
  if (transcript === undefined) {
    return undefined;
  }
  const convEnd = path.length - transcript.length - 1;
  const slash = normalized.lastIndexOf("/", convEnd - 1);
  if (slash <= 0) {
    return undefined;
  }
  const conversationId = path.slice(slash + 1, convEnd);
  if (conversationId === "") {
    return undefined;
  }
  return { brainRoot: path.slice(0, slash), conversationId };
}

/** The walk for usage scans: matches only the compact `transcript.jsonl` so each conversation is counted once. */
export const AGY_TRANSCRIPT_FILES = {
  match: (name: string): boolean => name === AGY_TRANSCRIPT_FILE,
  maxDepth: 3
};
