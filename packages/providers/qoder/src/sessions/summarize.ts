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
import { QODER_CAPABILITIES } from "./capabilities.js";
import { createQoderTranslation } from "./events.js";

export async function summarizeQoderRecords(
  records: AsyncIterable<SourcedRecord>,
  promptsOptions?: SessionPromptsOptions
): Promise<Result<SessionSummaryWithPrompts, UnknownFormatGeneration>> {
  const translation = createQoderTranslation({ retain: false });
  const totals = emptyTotals();
  const prompts = emptyPrompts(promptsOptions);

  for await (const record of records) {
    const step = translation.step(record);
    let sawMainPrompt = false;
    const promptTexts: string[] = [];
    for (const part of step.parts) {
      if (part.kind === "tool_result" && part.payload.isError === true) {
        totals.failedTools += 1;
      } else if (part.kind === "compaction") {
        totals.compactions += 1;
      } else if (step.isMainLane && part.kind === "user" && isPrompt({ kind: part.kind, payload: part.payload })) {
        sawMainPrompt = true;
        const trimmed = part.payload.text?.trim();
        if (trimmed !== undefined && trimmed !== "") {
          promptTexts.push(trimmed);
        }
      }
    }
    if (sawMainPrompt) {
      totals.turns += 1;
      if (promptTexts.length > 0) {
        prompts.add(promptTexts.join("\n\n"));
      }
    }
  }

  for (const request of translation.requests()) {
    addRequest(totals, requestUsage({ payload: request }));
  }

  return ok(finishPass(totals, QODER_CAPABILITIES, translation.subagentCount(), prompts.list));
}
