import { type CodingAgentId, err, ok, type Result } from "@rivus/agent-kit-catalog/public";

import {
  type UnknownFormatGeneration,
  unknownFormatGeneration
} from "../../domain/transcript/errors/unknown-format-generation.js";
import {
  emptyPrompts,
  emptyTotals,
  finishPass,
  tallyTranscriptPart
} from "../../domain/transcript/services/fold-transcript.js";
import type { SourcedRecord } from "../../domain/transcript/value-objects/source-pointer.js";
import type { Capability } from "../../domain/transcript/value-objects/transcript.js";
import type { TranscriptEvent } from "../../domain/transcript/value-objects/transcript-event.js";
import type {
  SessionPromptsOptions,
  SessionSummaryWithPrompts
} from "../../domain/session/value-objects/session-summary.js";

/** How one agent's records become the running numbers of a summary. */
export interface RecordSummary {
  readonly agent: CodingAgentId;
  /** The file the records come from, for the `UnknownFormatGeneration` of a log without a header. */
  readonly file: string;
  /** The translation's step: events of one record at the time it inherits, or the record's unknown generation. */
  readonly step: (record: SourcedRecord, ts: number) => Result<readonly TranscriptEvent[], UnknownFormatGeneration>;
  /** The record's own time, when it has one; a record without one takes the previous record's. */
  readonly timeOf: (record: SourcedRecord) => number | undefined;
  /** Whether the record is the session header. */
  readonly isHeader: (record: SourcedRecord) => boolean;
  /** Everything the agent can record; the summary lists the subset its records showed. */
  readonly capabilities: readonly Capability[];
  readonly prompts: SessionPromptsOptions | undefined;
}

/** The summary of one log read in order: records through the translation, folded without keeping any event. */
export async function summarizeRecords(
  records: Iterable<SourcedRecord> | AsyncIterable<SourcedRecord>,
  options: RecordSummary
): Promise<Result<SessionSummaryWithPrompts, UnknownFormatGeneration>> {
  const totals = emptyTotals();
  const prompts = emptyPrompts(options.prompts);
  const seen = new Set<Capability>();
  let last: number | undefined;
  let sawHeader = false;
  for await (const record of records) {
    const ts = options.timeOf(record) ?? last ?? 1;
    last = ts;
    sawHeader ||= options.isHeader(record);
    const step = options.step(record, ts);
    if (!step.ok) {
      return err(step.error);
    }
    for (const part of step.value) {
      tallyTranscriptPart(part, totals, prompts, seen);
    }
  }
  if (!sawHeader) {
    return err(unknownFormatGeneration(options.agent, { file: options.file, offset: 0, length: 0, line: 1 }));
  }
  const capabilities = options.capabilities.filter((capability) => seen.has(capability));
  return ok(finishPass(totals, capabilities, 0, prompts.list));
}
