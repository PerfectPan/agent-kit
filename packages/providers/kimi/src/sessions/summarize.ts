import { KIMI_ID } from "../facts.js";
import { err, ok, type Result } from "@rivus/agent-kit-catalog/spi";
import {
  emptyPrompts,
  emptyTotals,
  finishPass,
  tallyTranscriptPart,
  type SessionPromptsOptions,
  type SessionSummaryWithPrompts,
  type SourcedRecord,
  type UnknownFormatGeneration,
  unknownFormatGeneration
} from "@rivus/agent-kit-sessions/spi";
import { createKimiTranslation } from "./events.js";
import { KIMI_CAPABILITIES } from "./capabilities.js";

/** The wire streams of one session: the main lane first, then each subagent's, in the load pass's lane order. */
export interface KimiRecordStreams {
  main: AsyncIterable<SourcedRecord>;
  subagents: readonly AsyncIterable<SourcedRecord>[];
}

/**
 * Folds one lane's records with a `retain: false` translation. The prompts sink stays out: a lane's user records
 * only count as turns on the main lane, so subagent lanes tally into their own totals whose turns the caller drops.
 * `record` names the first record a foreign protocol version rejected, `undefined` when the lane folded.
 */
async function tallyLane(
  records: AsyncIterable<SourcedRecord>,
  totals: ReturnType<typeof emptyTotals>,
  prompts: ReturnType<typeof emptyPrompts>
): Promise<{ record: SourcedRecord | undefined; failed?: true }> {
  const translation = createKimiTranslation({ retain: false });
  for await (const record of records) {
    const step = translation.step(record);
    if (!step.ok) {
      return { record };
    }
    for (const part of step.parts) {
      tallyTranscriptPart(part, totals, prompts);
    }
  }
  return { record: undefined };
}

/**
 * The SessionSummary of one Kimi session, translated straight from its wire records with the result folding the
 * loaded transcript gives. The record rules come from `createKimiTranslation` without retain, the same dispatch the
 * translation runs; this function adds only the running numbers. Usage rides each step's end, and the lanes fold in
 * the load pass's order — the main wire, then each subagent's — so the request list matches the transcript's.
 * The state grows with requests and tool calls, never with the session's bytes.
 */
export async function summarizeKimiRecords(
  streams: KimiRecordStreams,
  promptsOptions?: SessionPromptsOptions
): Promise<Result<SessionSummaryWithPrompts, UnknownFormatGeneration>> {
  const totals = emptyTotals();
  const prompts = emptyPrompts(promptsOptions);

  const main = await tallyLane(streams.main, totals, prompts);
  if (main.record !== undefined) {
    return err(unknownFormatGeneration(KIMI_ID, main.record));
  }

  // Subagent lanes tally into their own totals: their requests, durations, compactions and failed tools join the
  // session's, their turns do not, and an unreadable or foreign-versioned wire just is not a lane — the same skip
  // the load pass applies.
  let subagents = 0;
  for (const stream of streams.subagents) {
    const laneTotals = emptyTotals();
    const lane = await tallyLane(stream, laneTotals, emptyPrompts(undefined)).catch(() => ({
      record: undefined,
      failed: true as const
    }));
    if (lane.failed || lane.record !== undefined) {
      continue;
    }
    subagents += 1;
    totals.requests += laneTotals.requests;
    for (const usage of laneTotals.usage) {
      totals.usage.push(usage);
    }
    for (const duration of laneTotals.turnDurations) {
      totals.turnDurations.push(duration);
    }
    for (const duration of laneTotals.requestDurations) {
      totals.requestDurations.push(duration);
    }
    totals.compactions += laneTotals.compactions;
    totals.failedTools += laneTotals.failedTools;
  }

  return ok(finishPass(totals, KIMI_CAPABILITIES, subagents, prompts.list));
}
