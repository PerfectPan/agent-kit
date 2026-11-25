import { definedFields, err, ok, type Result } from "@rivus/agent-kit-catalog/spi";
import {
  emptyPrompts,
  emptyTotals,
  finishPass,
  readJsonlStream,
  tallyTranscriptPart,
  type SessionPlatform,
  type SessionPromptsOptions,
  type SessionSummaryWithPrompts,
  type UnknownFormatGeneration
} from "@rivus/agent-kit-sessions/spi";
import { createCopilotTranslation } from "./events.js";
import { resolveCopilotJournalChain } from "./journal.js";

/**
 * The SessionSummary of one GitHub Copilot CLI session, streamed directly from its journal chain oldest-first using
 * the same translation rules as `load` without retaining events.
 */
export async function summarizeCopilotSession(
  platform: SessionPlatform,
  path: string,
  signal: AbortSignal | undefined,
  promptsOptions?: SessionPromptsOptions
): Promise<Result<SessionSummaryWithPrompts, UnknownFormatGeneration>> {
  const totals = emptyTotals();
  const prompts = emptyPrompts(promptsOptions);
  const noPrompts = emptyPrompts(undefined);
  const translation = createCopilotTranslation({ retain: false });
  const chain = await resolveCopilotJournalChain(platform, path, signal);

  for (const [index, segmentPath] of chain.entries()) {
    const hasPrevious = index > 0;
    for await (const record of readJsonlStream(platform, segmentPath, definedFields({ signal }))) {
      const stepped = translation.step(record, hasPrevious);
      if (!stepped.ok) {
        return err(stepped.error);
      }
      for (const part of stepped.parts) {
        if (part.mainLane) {
          tallyTranscriptPart(part.body, totals, prompts);
        } else if (part.body.kind !== "user") {
          tallyTranscriptPart(part.body, totals, noPrompts);
        }
      }
    }
  }

  return ok(finishPass(totals, translation.capabilities, translation.subagentCount, prompts.list));
}
