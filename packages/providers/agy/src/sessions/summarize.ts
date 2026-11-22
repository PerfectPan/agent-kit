import { ok, type Result } from "@rivus/agent-kit-catalog/spi";
import {
  emptyPrompts,
  emptyTotals,
  finishPass,
  tallyTranscriptPart,
  type SessionPromptsOptions,
  type SessionSummaryWithPrompts,
  type SourcedRecord,
  type UnknownFormatGeneration
} from "@rivus/agent-kit-sessions/spi";
import { AGY_CAPABILITIES } from "./capabilities.js";
import { createAgyTranslation } from "./events.js";

export async function summarizeAgyRecords(
  records: AsyncIterable<SourcedRecord>,
  promptsOptions?: SessionPromptsOptions
): Promise<Result<SessionSummaryWithPrompts, UnknownFormatGeneration>> {
  const translation = createAgyTranslation({ retain: false });
  const totals = emptyTotals();
  const prompts = emptyPrompts(promptsOptions);

  for await (const record of records) {
    for (const part of translation.step(record).parts) {
      tallyTranscriptPart(part, totals, prompts);
    }
  }

  return ok(finishPass(totals, AGY_CAPABILITIES, 0, prompts.list));
}
