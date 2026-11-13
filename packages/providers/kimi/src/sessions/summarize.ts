import { KIMI_ID } from "../facts.js";
import { err, ok, type Result } from "@rivus/agent-kit-catalog/spi";
import {
  addRequest,
  addTurnDuration,
  emptyPrompts,
  emptyTotals,
  finishPass,
  isPrompt,
  requestUsage,
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
  const translation = createKimiTranslation({ retain: false });
  const totals = emptyTotals();
  const prompts = emptyPrompts(promptsOptions);

  for await (const record of records) {
    const step = translation.step(record);
    if (!step.ok) {
      return err(unknownFormatGeneration(KIMI_ID, record));
    }
    for (const part of step.parts) {
      if (part.kind === "request") {
        addRequest(totals, requestUsage({ payload: part.payload }));
      } else if (part.kind === "tool_result" && part.payload.isError === true) {
        totals.failedTools += 1;
      } else if (part.kind === "system" && part.payload.type === "turn_duration") {
        addTurnDuration(totals, part.payload.durationMs);
      } else if (part.kind === "user" && isPrompt({ kind: part.kind, payload: part.payload })) {
        totals.turns += 1;
        prompts.add(part.payload.text);
      }
    }
  }

  return ok(finishPass(totals, KIMI_CAPABILITIES, 0, prompts.list));
}
