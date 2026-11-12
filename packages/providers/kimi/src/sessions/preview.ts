import type { SessionPreview } from "@rivus/agent-kit-sessions/spi";
import { kimiHeaderOf, kimiTurnPromptOf, kimiContentText } from "../records.js";

/**
 * The head a `wire.jsonl`'s two ends preview: the metadata line gates the generation, `turn.prompt` gives the first
 * user prompt and the start time, and the newest time on either end is the last activity. Subagent lanes return
 * nothing, so the walk's `agents/<id>/wire.jsonl` files list no sessions.
 */
export function previewKimiRecords(records: readonly Record<string, unknown>[], path: string): SessionPreview {
  if (!path.endsWith("/agents/main/wire.jsonl")) {
    return {};
  }
  const header = kimiHeaderOf(records.find((record) => record["type"] === "metadata") ?? {});
  if (header === undefined || !header.protocol_version.startsWith("1.")) {
    return {};
  }
  let firstPrompt: string | undefined;
  let startedAt: number | undefined;
  let lastAt: number | undefined;
  for (const record of records) {
    const time = typeof record["time"] === "number" ? record["time"] : undefined;
    if (time !== undefined) {
      lastAt = lastAt === undefined ? time : Math.max(lastAt, time);
    }
    if (record["type"] === "metadata" && typeof record["created_at"] === "number") {
      startedAt = record["created_at"] as number;
    }
    if (firstPrompt === undefined && record["type"] === "turn.prompt") {
      const prompt = kimiTurnPromptOf(record);
      if (prompt !== undefined && prompt.origin?.kind === "user") {
        firstPrompt = kimiContentText(prompt.input)?.slice(0, 500);
      }
    }
  }
  return {
    ...(firstPrompt !== undefined ? { firstPrompt } : {}),
    ...(startedAt !== undefined ? { startedAt } : {}),
    ...(lastAt !== undefined ? { lastAt } : {})
  };
}
