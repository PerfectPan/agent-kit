import { ok, type Result } from "@rivus/agent-kit-catalog/spi";
import {
  addRequest,
  emptyPrompts,
  emptyTotals,
  finishPass,
  isPrompt,
  requestUsage,
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
    const step = translation.step(record);
    for (const part of step.parts) {
      if (part.kind === "request") {
        addRequest(totals, requestUsage({ payload: part.payload }));
      } else if (part.kind === "tool_result" && part.payload.isError === true) {
        totals.failedTools += 1;
      } else if (part.kind === "compaction") {
        totals.compactions += 1;
      } else if (part.kind === "user" && isPrompt({ kind: part.kind, payload: part.payload })) {
        totals.turns += 1;
        prompts.add(part.payload.text);
      }
    }
  }

  return ok(finishPass(totals, AGY_CAPABILITIES, 0, prompts.list));
}
