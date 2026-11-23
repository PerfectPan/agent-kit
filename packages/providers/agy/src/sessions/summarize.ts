import { ok, type Result } from "@rivus/agent-kit-catalog/spi";
import {
  catchIoFailure,
  emptyPrompts,
  emptyTotals,
  finishPass,
  readJsonlStream,
  type SessionPlatform,
  type SessionPromptsOptions,
  type SessionSummaryWithPrompts,
  type SourcedRecord,
  type UnknownFormatGeneration,
  tallyTranscriptPart
} from "@rivus/agent-kit-sessions/spi";
import { AGY_ID } from "../facts.js";
import { AGY_CAPABILITIES } from "./capabilities.js";
import { createAgyTranslation, type AgySpawn } from "./events.js";
import { agyTranscriptPath, createAgySpawnQueue, type AgyChildLane } from "./subagents.js";

export interface AgySummarizeOptions {
  readonly platform: SessionPlatform;
  /** The root conversation's records, in file order. */
  readonly records: AsyncIterable<SourcedRecord>;
  /** The root conversation's id, which the subagent walk never attaches again. */
  readonly rootId: string;
  /**
   * The brain root the subagent conversations sit under; `undefined` when the root path is outside the layout, so
   * every spawned conversation is a lane without a transcript, as the load pass attaches it.
   */
  readonly brainRoot: string | undefined;
  readonly signal: AbortSignal | undefined;
  readonly prompts?: SessionPromptsOptions;
}

/** What folding one subagent lane's transcript yielded; `undefined` when the transcript did not read to its end. */
interface AgyLaneTally {
  readonly totals: ReturnType<typeof emptyTotals>;
  readonly spawns: ReadonlyMap<string, AgySpawn>;
}

/**
 * Folds one subagent lane's records into totals of their own: its user records are not the session's turns, and a
 * stream that fails before its end is a lane without a transcript in the load pass, so nothing of it counts here.
 * An abort still rejects.
 */
async function tallyAgyLane(
  platform: SessionPlatform,
  lane: AgyChildLane,
  path: string,
  signal: AbortSignal | undefined
): Promise<AgyLaneTally | undefined> {
  const totals = emptyTotals();
  const noPrompts = emptyPrompts(undefined);
  const translation = createAgyTranslation({ retain: false, laneId: lane.conversationId });
  const folded = await catchIoFailure(platform, path, signal, async (guarded) => {
    for await (const record of readJsonlStream(guarded, path, { signal })) {
      for (const part of translation.step(record).parts) {
        tallyTranscriptPart(part, totals, noPrompts);
      }
    }
  });
  return folded.ok ? { totals, spawns: translation.spawns } : undefined;
}

/**
 * The SessionSummary of one Antigravity CLI conversation, translated straight from its records with the result
 * folding the loaded transcript gives. The record rules come from `createAgyTranslation` without retain, the same
 * dispatch the translation runs; this function adds only the running numbers. The subagent conversations join in the
 * load pass's order — the root's children in spawn order, then theirs — so the request list matches the
 * transcript's, and a lane whose transcript is missing or unreadable counts as a subagent and adds nothing else.
 * The state grows with requests and tool calls, never with the session's bytes.
 */
export async function summarizeAgyRecords({
  platform,
  records,
  rootId,
  brainRoot,
  signal,
  prompts: promptsOptions
}: AgySummarizeOptions): Promise<Result<SessionSummaryWithPrompts, UnknownFormatGeneration>> {
  const totals = emptyTotals();
  const prompts = emptyPrompts(promptsOptions);
  const translation = createAgyTranslation({ retain: false });
  for await (const record of records) {
    for (const part of translation.step(record).parts) {
      tallyTranscriptPart(part, totals, prompts);
    }
  }

  const queue = createAgySpawnQueue(rootId);
  queue.enqueue(translation.spawns, AGY_ID);
  let subagents = 0;
  for (let lane = queue.next(); lane !== undefined; lane = queue.next()) {
    signal?.throwIfAborted();
    const path =
      brainRoot === undefined
        ? undefined
        : await agyTranscriptPath(platform, `${brainRoot}/${lane.conversationId}`, signal);
    const tally = path === undefined ? undefined : await tallyAgyLane(platform, lane, path, signal);
    subagents += 1;
    if (tally === undefined) {
      continue;
    }
    totals.requests += tally.totals.requests;
    totals.usage.push(...tally.totals.usage);
    totals.turnDurations.push(...tally.totals.turnDurations);
    totals.requestDurations.push(...tally.totals.requestDurations);
    totals.compactions += tally.totals.compactions;
    totals.failedTools += tally.totals.failedTools;
    queue.enqueue(tally.spawns, lane.conversationId);
  }

  return ok(finishPass(totals, AGY_CAPABILITIES, subagents, prompts.list));
}
