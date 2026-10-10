import { err, ok, type Result } from "@rivus/agent-kit-catalog";

import {
  addTurnDuration,
  emptyTotals,
  finishTotals,
  type Capability,
  type StampedRecord,
  summaryOf,
  type UnknownFormatGeneration,
  unknownFormatGeneration
} from "../../index.js";
import { addRequest } from "../../services/fold-transcript.js";
import { isPrompt, requestUsage } from "../../policies/turns.js";
import type { SessionPromptsOptions, SessionPrompt, SessionSummaryWithPrompts } from "../../../session/index.js";
import { CODEX_CAPABILITIES } from "./events.js";
import { codexPayload, codexRecord } from "./records.js";
import { FORK_REPLAY_START, stepForkReplay, trackForkReplayEnd } from "./fork-replay.js";
import { createCodexTranslation } from "./translation.js";

const AGENT = "codex";

export interface CodexSummarizeOptions {
  /** Collect the main lane's user prompts under these caps. */
  prompts?: SessionPromptsOptions;
}

/**
 * The end of a forked rollout's replay, decided while the records stream past: the same bookkeeping
 * `scanForkReplay` runs, a record at a time and without holding any of them. The batch rule's
 * `replayed = index < end` needs the end before the fold, so this is the summarize pass's first read. Reading stops
 * once the end is decided — a non-fork rollout decides at its first record — because appended records cannot
 * un-decide it. While the end is undecided it is `total`, which an append moves, so the outcome reports how many
 * records the end was decided on and the fold reads no further than that.
 */
async function scanForkReplayEndWhileReading(
  stamped: AsyncIterable<StampedRecord>
): Promise<{ end: number; decided: boolean; covered: number }> {
  let state = FORK_REPLAY_START;
  const tracker = trackForkReplayEnd();
  let total = 0;
  for await (const { record, ts } of stamped) {
    const rec = codexRecord(record.value);
    const payload = codexPayload(rec?.payload);
    const step = stepForkReplay(state, rec, payload, ts);
    tracker.step(step, total);
    total += 1;
    state = step.state;
    if (tracker.isDecided()) {
      break;
    }
  }
  return { end: tracker.end(total, state), decided: tracker.isDecided(), covered: total };
}

/**
 * The SessionSummary of one Codex rollout, translated straight from its records with the result
 * `foldTranscript(translateCodexRecords(...))` gives. The record rules come from `createCodexTranslation` without
 * retain, the same dispatch the translation runs; this function adds only the running numbers. The pass reads the
 * rollout twice — once to decide the replay's end, once to fold — and keeps the usage of each response id, the
 * tracker, the fork state and the subagent lanes, so the state grows with requests and subagents, never with the
 * rollout's bytes.
 *
 * The passes after the translation read nothing the summary needs: the shadowing of `compacted` records, the spawn
 * links and the orphan flags set references, and the event ids' duplicate protection only names events.
 */
export async function summarizeCodexRecords(
  /** A fresh stamped stream per read: the pass reads the rollout twice, and a stream does not restart. */
  stamped: () => AsyncIterable<StampedRecord>,
  options: CodexSummarizeOptions = {}
): Promise<Result<SessionSummaryWithPrompts, UnknownFormatGeneration>> {
  const { end, decided, covered } = await scanForkReplayEndWhileReading(stamped());
  const pass = createCodexTranslation({ retain: false });
  const totals = emptyTotals();
  const prompts = options.prompts === undefined ? undefined : ([] as SessionPrompt[]);
  const limit = options.prompts?.limit ?? 0;
  const maxChars = options.prompts?.maxChars ?? 0;
  let seen = 0;
  for await (const { record, ts } of stamped()) {
    // While the end is undecided it is the record count, which an append moves: fold exactly what the first read
    // covered. A decided end cannot be un-decided by an append, so the fold reads on.
    if (!decided && seen >= covered) {
      break;
    }
    const outcome = pass.step(record, ts, { replayed: seen < end, justEnded: seen === end });
    if (!outcome.ok) {
      return err(unknownFormatGeneration(AGENT, record));
    }
    seen += 1;
    for (const part of outcome.parts) {
      if (part.kind === "request") {
        addRequest(totals, requestUsage(part));
      } else if (part.kind === "tool_result") {
        if (part.payload.isError === true) {
          totals.failedTools += 1;
        }
      } else if (part.kind === "system" && part.payload.type === "turn_duration") {
        addTurnDuration(totals, part.payload.durationMs);
      } else if (part.kind === "compaction") {
        totals.compactions += 1;
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
  // `CODEX_CAPABILITIES` lists requests, usage, durations, compaction and subagents for every rollout.
  const declared = new Set<Capability>(CODEX_CAPABILITIES);
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
      pass.agents.filter((agent) => agent.parentId !== undefined).length
    )
  );
  return ok(prompts === undefined ? summary : { ...summary, prompts });
}
