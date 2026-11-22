import { type Result } from "@rivus/agent-kit-catalog/spi";
import {
  type SessionPromptsOptions,
  type SessionReadError,
  type SessionRef,
  type SessionSummaryWithPrompts,
  catchIoFailure,
  readJsonlStream,
  recordTime,
  summarizeRecords,
  type SessionPlatform
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
  const read = await catchIoFailure(platform, ref.path, signal, (guarded) => {
    signal?.throwIfAborted();
    const translation = createPiTranslation({
      retain: false,
      ...(ref.sessionId === undefined ? {} : { sessionId: ref.sessionId })
    });
    return summarizeRecords(readJsonlStream(guarded, ref.path, { signal }), {
      agent: PI_ID,
      file: ref.path,
      step: translation.step,
      timeOf: recordTime,
      isHeader: (record) => piHeaderOf(record.value) !== undefined,
      capabilities: PI_CAPABILITIES,
      prompts: promptsOptions
    });
  });
  if (!read.ok) {
    return read;
  }
  return read.value;
}
