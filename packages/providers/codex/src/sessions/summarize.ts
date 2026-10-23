import { CODEX_ID } from "../facts.js";
import { err, ok, type Result } from "@rivus/agent-kit-catalog/spi";
import {
  addTurnDuration,
  emptyTotals,
  type SourcedRecord,
  type TimedRecord,
  type UnknownFormatGeneration,
  unknownFormatGeneration,
  addRequest,
  emptyPrompts,
  finishPass,
  isPrompt,
  requestUsage,
  type SessionPromptsOptions,
  type SessionSummaryWithPrompts
} from "@rivus/agent-kit-sessions/spi";
import { CODEX_CAPABILITIES } from "./events.js";
import { codexPayload, codexRecord } from "../records/record.js";
import { FORK_REPLAY_START, stepForkReplay, trackForkReplayEnd } from "../records/fork-replay.js";
import { createCodexTranslation } from "./translation.js";

const AGENT = CODEX_ID;

export interface CodexSummarizeOptions {
  /** Collect the main lane's user prompts under these caps. */
  prompts?: SessionPromptsOptions;
}

/** A record with the time the pass reads it at: `ts` is `undefined` in the leading run no record has stamped yet. */
export interface CodexStampedRecord {
  readonly record: SourcedRecord;
  readonly ts: number | undefined;
}

/**
 * Stamps one rollout in file order the way `mergeByTime` stamps a single group, without holding the records that
 * precede the first known time: each takes the previous known time, and a leading one has none yet, which the
 * fork-replay rule reads as "the batch rule's stamp for it is not known yet". A file that names no time at all
 * leaves every `ts` `undefined`, where `mergeByTime` would stamp 1.
 */
async function* stampWhileReading(timed: AsyncIterable<TimedRecord>): AsyncGenerator<CodexStampedRecord> {
  let lastKnown: number | undefined;
  for await (const { record, time } of timed) {
    if (time === undefined) {
      yield { record, ts: lastKnown };
    } else {
      lastKnown = time;
      yield { record, ts: time };
    }
  }
}

/**
 * The end of a forked rollout's replay, decided while the records stream past: the same bookkeeping
 * `scanForkReplay` runs, a record at a time and without holding any of them. The batch rule's
 * `replayed = index < end` needs the end before the fold, so this is the summarize pass's first read. Reading stops
 * once the end is decided — a non-fork rollout decides at its first record — because appended records cannot
 * un-decide it. The outcome reports how many records the first read covered, decided or not: while the end is
 * undecided it is that count, which an append moves, so the fold reads no further than it.
 */
async function scanForkReplayEndWhileReading(
  stamped: AsyncIterable<CodexStampedRecord>
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
  /** A fresh stream of the rollout's records with their own times per read: the pass reads the rollout twice, and a
   * stream does not restart. */
  timed: () => AsyncIterable<TimedRecord>,
  options: CodexSummarizeOptions = {}
): Promise<Result<SessionSummaryWithPrompts, UnknownFormatGeneration>> {
  const { end, decided, covered } = await scanForkReplayEndWhileReading(stampWhileReading(timed()));
  const pass = createCodexTranslation({ retain: false });
  const totals = emptyTotals();
  const prompts = emptyPrompts(options.prompts);
  let seen = 0;
  for await (const { record, ts } of stampWhileReading(timed())) {
    // While the end is undecided it is the record count, which an append moves: fold exactly what the first read
    // covered. A decided end cannot be un-decided by an append, so the fold reads on.
    if (!decided && seen >= covered) {
      break;
    }
    // The summary's numbers read no times, so a record the first known time has not reached yet takes the stamp a
    // wholly time-less file gets.
    const outcome = pass.step(record, ts ?? 1, { replayed: seen < end, justEnded: seen === end });
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
        prompts.add(part.payload.text);
      }
    }
  }
  // `CODEX_CAPABILITIES` lists requests, usage, durations, compaction and subagents for every rollout.
  return ok(
    finishPass(
      totals,
      CODEX_CAPABILITIES,
      pass.agents.filter((agent) => agent.parentId !== undefined).length,
      prompts.list
    )
  );
}
