import { definedFields } from "@rivus/agent-kit-catalog/spi";
import type { SessionPreview } from "@rivus/agent-kit-sessions/spi";
import {
  copilotContentOf,
  copilotRecordOf,
  copilotRecordTime,
  copilotResumeCwdOf,
  copilotSessionStartOf
} from "../records.js";

/**
 * The head an `events.jsonl`'s two ends preview: `session.start` / `session.resume` provide `cwd`, the first
 * main-lane `user.message` gives `firstPrompt`, and the earliest / latest `timestamp` values give `startedAt` /
 * `lastAt`.
 */
export function previewCopilotRecords(records: readonly Record<string, unknown>[]): SessionPreview {
  let cwd: string | undefined;
  let firstPrompt: string | undefined;
  let startedAt: number | undefined;
  let lastAt: number | undefined;
  for (const raw of records) {
    const record = copilotRecordOf(raw);
    if (record === undefined) {
      continue;
    }
    const time = copilotRecordTime(record);
    if (time !== undefined) {
      startedAt = startedAt === undefined ? time : Math.min(startedAt, time);
      lastAt = lastAt === undefined ? time : Math.max(lastAt, time);
    }
    if (record.type === "session.start") {
      const start = copilotSessionStartOf(record);
      if (start?.cwd !== undefined && start.cwd !== "") {
        cwd = start.cwd;
      }
    } else if (record.type === "session.resume") {
      const resumed = copilotResumeCwdOf(record);
      if (resumed !== undefined && resumed !== "") {
        cwd = resumed;
      }
    } else if (firstPrompt === undefined && record.type === "user.message" && record.agentId === undefined) {
      const content = copilotContentOf(record);
      if (content !== undefined && content !== "") {
        firstPrompt = content.slice(0, 500);
      }
    }
  }
  return definedFields({ cwd, firstPrompt, startedAt, lastAt });
}
