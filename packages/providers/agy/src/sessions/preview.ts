import type { SessionPreview } from "@rivus/agent-kit-sessions/spi";
import { agyRecordTime, agyStepOf } from "../records.js";

/**
 * The head a transcript JSONL's two ends preview: the first `USER_INPUT` gives the first prompt, and the earliest /
 * latest `created_at` timestamps give `startedAt` and `lastAt`.
 */
export function previewAgyRecords(records: readonly Record<string, unknown>[]): SessionPreview {
  let firstPrompt: string | undefined;
  let startedAt: number | undefined;
  let lastAt: number | undefined;
  for (const record of records) {
    const step = agyStepOf(record);
    if (step === undefined) {
      continue;
    }
    const time = agyRecordTime(step);
    if (time !== undefined) {
      startedAt = startedAt === undefined ? time : Math.min(startedAt, time);
      lastAt = lastAt === undefined ? time : Math.max(lastAt, time);
    }
    if (firstPrompt === undefined && step.type === "USER_INPUT" && step.content !== undefined && step.content !== "") {
      firstPrompt = step.content.slice(0, 500);
    }
  }
  return {
    ...(firstPrompt !== undefined ? { firstPrompt } : {}),
    ...(startedAt !== undefined ? { startedAt } : {}),
    ...(lastAt !== undefined ? { lastAt } : {})
  };
}
