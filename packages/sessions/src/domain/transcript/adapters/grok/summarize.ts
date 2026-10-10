import { err, ok, type Result } from "@rivus/agent-kit-catalog";

import {
  addTurnDuration,
  emptyTotals,
  isPrompt,
  type SourcedRecord,
  type UnknownFormatGeneration,
  unknownFormatGeneration
} from "../../index.js";
import { addRequest, emptyPrompts, finishPass } from "../../services/fold-transcript.js";
import { requestUsage } from "../../policies/turns.js";
import type { SessionPromptsOptions, SessionSummaryWithPrompts } from "../../../session/index.js";
import type { GrokSubagentMeta } from "../../../session/adapters/grok/layout.js";
import { GROK_CAPABILITIES } from "./events.js";
import { applyGrokSubagents, createGrokTranslation } from "./translation.js";

const AGENT = "grok";

export interface GrokSummarizeOptions {
  /** `meta.json` of each `<session>/subagents/<id>/` directory, keyed by the directory name. */
  subagents?: ReadonlyMap<string, GrokSubagentMeta>;
  /** Collect the main lane's user prompts under these caps. */
  prompts?: SessionPromptsOptions;
}

/**
 * The SessionSummary of one Grok session, translated straight from its records with the result
 * `foldTranscript(translateGrokRecords(...))` gives. The record rules come from `createGrokTranslation` without
 * retain, the same dispatch the translation runs; this function adds only the running numbers. Grok logs usage per
 * turn and places each request before the turn's output, so request order is processing order — the pass reads no
 * record times and takes the records as the file holds them. It keeps the usage of each turn, one lane per named
 * subagent, one status per tool call, and two prompt strings, so the state grows with requests, tool calls and
 * subagents, never with the session's bytes.
 *
 * The passes after the translation read nothing the summary needs: `shadowBefore` marks references, the orphan
 * flags name unpaired results, and the `request:<key>` id dedupe and spawn links only name events.
 */
export async function summarizeGrokRecords(
  records: AsyncIterable<SourcedRecord>,
  options: GrokSummarizeOptions = {}
): Promise<Result<SessionSummaryWithPrompts, UnknownFormatGeneration>> {
  const translation = createGrokTranslation({ retain: false });
  const totals = emptyTotals();
  const prompts = emptyPrompts(options.prompts);

  for await (const record of records) {
    const step = translation.step(record);
    if (!step.ok) {
      return err(unknownFormatGeneration(AGENT, record));
    }
    for (const part of step.parts) {
      if (part.kind === "request") {
        addRequest(totals, requestUsage(part));
      } else if (part.kind === "compaction") {
        totals.compactions += 1;
      } else if (part.kind === "system" && part.payload.type === "turn_duration") {
        addTurnDuration(totals, part.payload.durationMs);
      } else if (part.kind === "user" && isPrompt(part)) {
        totals.turns += 1;
        prompts.add(part.payload.text);
      }
    }
  }

  for (const failed of translation.toolResults.values()) {
    if (failed) {
      totals.failedTools += 1;
    }
  }
  const agents = [...translation.agents];
  applyGrokSubagents(agents, options.subagents);

  // `GROK_CAPABILITIES` lists requests, usage, durations, compaction and subagents for every session.
  return ok(
    finishPass(totals, GROK_CAPABILITIES, agents.filter((agent) => agent.parentId !== undefined).length, prompts.list)
  );
}
