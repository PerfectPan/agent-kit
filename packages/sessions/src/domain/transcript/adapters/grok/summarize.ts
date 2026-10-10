import { err, ok, type Result } from "@rivus/agent-kit-catalog";

import {
  addTurnDuration,
  emptyTotals,
  finishTotals,
  type Capability,
  isPrompt,
  type StampedRecord,
  summaryOf,
  type UnknownFormatGeneration,
  unknownFormatGeneration
} from "../../index.js";
import { addRequest } from "../../services/fold-transcript.js";
import { requestUsage } from "../../policies/turns.js";
import type { SessionPromptsOptions, SessionPrompt, SessionSummaryWithPrompts } from "../../../session/index.js";
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
 * turn and places each request before the turn's output, so request order is processing order. The pass keeps the
 * usage of each turn, one lane per named subagent, one status per tool call, and two prompt strings, so the state
 * grows with requests, tool calls and subagents, never with the session's bytes.
 *
 * The passes after the translation read nothing the summary needs: `shadowBefore` marks references, the orphan
 * flags name unpaired results, and the `request:<key>` id dedupe and spawn links only name events.
 */
export async function summarizeGrokRecords(
  stamped: AsyncIterable<StampedRecord>,
  options: GrokSummarizeOptions = {}
): Promise<Result<SessionSummaryWithPrompts, UnknownFormatGeneration>> {
  const translation = createGrokTranslation({ retain: false });
  const totals = emptyTotals();
  const prompts = options.prompts === undefined ? undefined : ([] as SessionPrompt[]);
  const limit = options.prompts?.limit ?? 0;
  const maxChars = options.prompts?.maxChars ?? 0;

  for await (const { record, ts } of stamped) {
    const step = translation.step(record, ts);
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
        if (prompts !== undefined && prompts.length < limit) {
          const text = part.payload.text;
          if (typeof text === "string" && text !== "") {
            prompts.push({ text: text.slice(0, maxChars) });
          }
        }
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
  const declared = new Set<Capability>(GROK_CAPABILITIES);
  const summary = summaryOf(
    finishTotals(
      totals,
      {
        requests: declared.has("requests"),
        usage: declared.has("usage"),
        durations: declared.has("durations"),
        compaction: declared.has("compaction"),
        subagents: declared.has("subagents")
      },
      agents.filter((agent) => agent.parentId !== undefined).length
    )
  );
  return ok(prompts === undefined ? summary : { ...summary, prompts });
}
