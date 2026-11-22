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

/**
 * The SessionSummary of one Kimi session, translated straight from its wire records with the result folding the
 * loaded transcript gives. The record rules come from `createKimiTranslation` without retain, the same dispatch the
 * translation runs; this function adds only the running numbers. Usage rides each step's end, so request order is
 * processing order, and the state grows with requests and tool calls, never with the session's bytes.
 */
export async function summarizeKimiRecords(
  records: AsyncIterable<SourcedRecord>,
  promptsOptions?: SessionPromptsOptions
): Promise<Result<SessionSummaryWithPrompts, UnknownFormatGeneration>> {
  const totals = emptyTotals();
  const prompts = emptyPrompts(promptsOptions);
  const translation = createKimiTranslation({ retain: false });

  for await (const record of records) {
    const step = translation.step(record);
    if (!step.ok) {
      return err(unknownFormatGeneration(KIMI_ID, record));
    }
    for (const part of step.parts) {
      tallyTranscriptPart(part, totals, prompts);
    }
  }

  return ok(finishPass(totals, KIMI_CAPABILITIES, 0, prompts.list));
}
