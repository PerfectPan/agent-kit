import { type Result, err, ok } from "@rivus/agent-kit-catalog/spi";
import {
  type Capability,
  type SessionPromptsOptions,
  type SessionReadError,
  type SessionRef,
  type SessionSummaryWithPrompts,
  addRequest,
  catchIoFailure,
  emptyPrompts,
  emptyTotals,
  finishPass,
  isPrompt,
  readJsonlStream,
  recordTime,
  requestUsage,
  type SessionPlatform,
  unknownFormatGeneration
} from "@rivus/agent-kit-sessions/spi";

import { PI_ID } from "../facts.js";
import { piHeaderOf } from "../records.js";
import { createPiTranslation, PI_CAPABILITIES } from "./events.js";

/**
 * The summary of one Pi session in a bounded pass: the file streams through the same translation the load uses, and
 * only the running numbers, the capability flags and the prompts are kept. Pi logs no turn durations and no
 * subagents, so those stay out of the summary.
 */
export async function summarizePi(
  platform: SessionPlatform,
  ref: SessionRef,
  signal: AbortSignal | undefined,
  promptsOptions: SessionPromptsOptions | undefined
): Promise<Result<SessionSummaryWithPrompts, SessionReadError>> {
  const read = await catchIoFailure(platform, ref.path, signal, async (guarded) => {
    signal?.throwIfAborted();
    const translation = createPiTranslation({
      retain: false,
      ...(ref.sessionId === undefined ? {} : { sessionId: ref.sessionId })
    });
    const totals = emptyTotals();
    const prompts = emptyPrompts(promptsOptions);
    const seen = new Set<Capability>();
    let lastTime: number | undefined;
    let sawHeader = false;
    for await (const record of readJsonlStream(guarded, ref.path, { signal })) {
      const ts = recordTime(record) ?? lastTime ?? 1;
      lastTime = ts;
      if (piHeaderOf(record.value) !== undefined) {
        sawHeader = true;
      }
      const step = translation.step(record, ts);
      if (!step.ok) {
        return err(step.error);
      }
      for (const part of step.value) {
        if (part.kind === "request") {
          addRequest(totals, requestUsage(part));
          seen.add("requests");
          if (part.payload.usage !== undefined) {
            seen.add("usage");
          }
        } else if (part.kind === "compaction") {
          totals.compactions += 1;
          seen.add("compaction");
          if (part.payload.preTokens !== undefined || part.payload.postTokens !== undefined) {
            seen.add("compactionTokens");
          }
        } else if (part.kind === "reasoning") {
          seen.add("reasoning");
        } else if (part.kind === "tool_result" && part.payload.isError === true) {
          totals.failedTools += 1;
        } else if (part.kind === "user" && isPrompt(part)) {
          totals.turns += 1;
          prompts.add(part.payload.text ?? "");
        }
      }
    }
    if (!sawHeader) {
      return err(unknownFormatGeneration(PI_ID, { file: ref.path, offset: 0, length: 0, line: 1 }));
    }
    const capabilities = PI_CAPABILITIES.filter((capability) => seen.has(capability));
    return ok(finishPass(totals, capabilities, 0, prompts.list));
  });
  if (!read.ok) {
    return read;
  }
  return read.value;
}
