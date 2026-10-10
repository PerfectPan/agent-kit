import { err, ok, type Result } from "@rivus/agent-kit-catalog";

import {
  addTurnDuration,
  emptyTotals,
  MAIN_LANE_ID,
  type StampedRecord,
  type UnknownFormatGeneration,
  unknownFormatGeneration
} from "../../index.js";
import { addRequest, emptyPrompts, finishPass } from "../../services/fold-transcript.js";
import type { SessionPromptsOptions, SessionSummaryWithPrompts } from "../../../session/index.js";
import { type ClaudeCodeRecordValue, parseClaudeCodeRecord } from "./record.js";
import { CLAUDE_CODE_CAPABILITIES } from "./events.js";
import { type ClaudeCodeEventPart, claudeCodeLaneOf, classifyClaudeCodeRecord } from "./classify.js";
import { isPrompt } from "../../policies/turns.js";
import type { Usage } from "../../../usage/index.js";
import { claudeCodeRequestUsage, claudeCodeUsageOf } from "../../../usage/adapters/claude-code.js";

const AGENT = "claude-code";

export interface ClaudeCodeSummarizeOptions {
  /**
   * The lane of records from a subagent file whose records carry no `agentId`. A file's id is resolved before the
   * pass sees its first record, so the answer never changes while the file is being read.
   */
  agentForFile?: (file: string) => string | undefined;
  /** Collect the main lane's user prompts under these caps. */
  prompts?: SessionPromptsOptions;
}

/** What one request key keeps while the pass runs: the usage the translator's event would hold, and the entry of `totals.usage` its counts land in. */
interface RequestState {
  usage: Usage | undefined;
  counts: { inputTokens?: number; outputTokens?: number };
}

/**
 * The SessionSummary of one Claude Code session, translated straight from its records in `mergeByTimeStream` order
 * with the result `foldTranscript(translateClaudeCodeRecords(...))` gives: the record rules come from
 * `classifyClaudeCodeRecord`, the same dispatch the translation runs, and the request rules from
 * `claudeCodeRequestUsage` and `claudeCodeUsageOf`. Only the running numbers are kept: the usage of each request key
 * and the lanes that emitted an event, so the state grows with requests and subagents, never with the session's
 * bytes.
 *
 * The passes after the translation read nothing the summary needs: `resolveParents`, `shadowRemoved` and
 * `applySnapshots` set references and session fields, and `markOrphanToolResults` flags `orphan`, which
 * `failedTools` does not count. A compaction's `preservedSegment` only steers shadowing, so it is not read either.
 */
export async function summarizeClaudeCodeRecords(
  stamped: AsyncIterable<StampedRecord>,
  options: ClaudeCodeSummarizeOptions = {}
): Promise<Result<SessionSummaryWithPrompts, UnknownFormatGeneration>> {
  const totals = emptyTotals();
  /** One state per request key, in the order the keys were first seen; the counts alias `totals.usage`. */
  const requests = new Map<string, RequestState>();
  /** The lanes of the records that translated to an event; each becomes a subagent lane. */
  const lanes = new Set<string>();
  const prompts = emptyPrompts(options.prompts);

  const mergeRequest = (rec: ClaudeCodeRecordValue, key: string): void => {
    let state = requests.get(key);
    const chosen = claudeCodeRequestUsage(state?.usage, claudeCodeUsageOf(rec.message?.usage));
    if (state === undefined) {
      // One request event per key, at its first record: the count is the number of keys.
      state = { usage: undefined, counts: {} };
      requests.set(key, state);
      addRequest(totals, state.counts);
    }
    // Later records update the usage by `claudeCodeRequestUsage`; only its counts land in the entry.
    state.usage = chosen;
    if (chosen !== undefined) {
      state.counts.inputTokens = typeof chosen.inputTokens === "number" ? chosen.inputTokens : undefined;
      state.counts.outputTokens = typeof chosen.outputTokens === "number" ? chosen.outputTokens : undefined;
    }
  };

  for await (const { record } of stamped) {
    const rec = parseClaudeCodeRecord(record.value);
    if (!rec) {
      return err(unknownFormatGeneration(AGENT, record));
    }
    const laneId = claudeCodeLaneOf(rec, record.file, options.agentForFile);
    const classified = classifyClaudeCodeRecord(rec);
    if (classified.generationError) {
      return err(unknownFormatGeneration(AGENT, record));
    }
    if (classified.requestKey !== undefined) {
      mergeRequest(rec, classified.requestKey);
    }

    let promptPart: ClaudeCodeEventPart | undefined;
    for (const part of classified.events) {
      switch (part.kind) {
        case "tool_result":
          if (part.payload.isError === true) {
            totals.failedTools += 1;
          }
          break;
        case "compaction":
          totals.compactions += 1;
          break;
        case "system":
          if (part.payload.type === "turn_duration") {
            addTurnDuration(totals, part.payload.durationMs);
          }
          break;
        case "user":
          if (promptPart === undefined && isPrompt(part)) {
            promptPart = part;
          }
          break;
        default:
          break;
      }
    }
    if (promptPart !== undefined && (laneId === undefined || laneId === MAIN_LANE_ID)) {
      totals.turns += 1;
      // The prompt's text is the first non-empty text any of the record's user events carries.
      prompts.add(
        classified.events.find(
          (part) => part.kind === "user" && typeof part.payload.text === "string" && part.payload.text !== ""
        )?.payload.text
      );
    }

    if (classified.events.length > 0 && laneId !== undefined && laneId !== MAIN_LANE_ID) {
      lanes.add(laneId);
    }
  }

  // `CLAUDE_CODE_CAPABILITIES` lists requests, usage, durations, compaction and subagents for every session.
  return ok(finishPass(totals, CLAUDE_CODE_CAPABILITIES, lanes.size, prompts.list));
}
