import type { SessionPreview } from "@rivus/agent-kit-sessions/spi";
import { qoderRecordOf, qoderRecordTime, qoderUserText } from "../records.js";

/** The head a Qoder JSONL session's two ends preview: cwd, branch, first user prompt, and start/last timestamps. */
export function previewQoderRecords(records: readonly Record<string, unknown>[]): SessionPreview {
  let firstPrompt: string | undefined;
  let cwd: string | undefined;
  let gitBranch: string | undefined;
  let startedAt: number | undefined;
  let lastAt: number | undefined;
  for (const raw of records) {
    const record = qoderRecordOf(raw);
    if (record === undefined) {
      continue;
    }
    const time = qoderRecordTime(record);
    if (time !== undefined) {
      startedAt = startedAt === undefined ? time : Math.min(startedAt, time);
      lastAt = lastAt === undefined ? time : Math.max(lastAt, time);
    }
    if (cwd === undefined && record.cwd !== undefined) {
      cwd = record.cwd;
    }
    if (gitBranch === undefined && record.gitBranch !== undefined) {
      gitBranch = record.gitBranch;
    }
    if (
      firstPrompt === undefined &&
      record.type === "user" &&
      record.isMeta !== true &&
      record.isCompactSummary !== true
    ) {
      const text = qoderUserText(record.message);
      if (text !== undefined) {
        firstPrompt = text.slice(0, 500);
      }
    }
  }
  return {
    ...(firstPrompt !== undefined ? { firstPrompt } : {}),
    ...(cwd !== undefined ? { cwd } : {}),
    ...(gitBranch !== undefined ? { gitBranch } : {}),
    ...(startedAt !== undefined ? { startedAt } : {}),
    ...(lastAt !== undefined ? { lastAt } : {})
  };
}
