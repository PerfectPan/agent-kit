import { err, ok, type Result } from "@rivus/agent-kit-catalog";

import {
  addTurnDuration,
  emptyTotals,
  finishTotals,
  type Capability,
  MAIN_LANE_ID,
  type StampedRecord,
  summaryOf,
  type UnknownFormatGeneration,
  unknownFormatGeneration
} from "../../index.js";
import type { SessionPromptsOptions, SessionPrompt, SessionSummaryWithPrompts } from "../../../session/index.js";
import { BOOKKEEPING, CLAUDE_CODE_CAPABILITIES } from "./events.js";
import { promptSnapshotPayload } from "./prompt-snapshot.js";
import { type ClaudeCodeRecordValue, parseClaudeCodeRecord } from "./record.js";
import { type ClaudeCodeUserFlags, isPromptFlags, userFlags } from "./user-flags.js";
import {
  claudeCodeRequestKey,
  claudeCodeRequestUsage,
  claudeCodeUsageOf
} from "../../../usage/adapters/claude-code.js";

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

/** Whether the record translates to at least one `user`-kind event: string content, no content, or a text or image block. */
function emitsUserEvent(rec: ClaudeCodeRecordValue): boolean {
  const content = rec.message?.content;
  if (typeof content === "string" || !Array.isArray(content) || content.length === 0) {
    return true;
  }
  return content.some((block) => block?.type === "text" || block?.type === "image");
}

/**
 * The record's prompt text: the first text the translation puts in a `user` event's payload — the string content, or
 * the first text block with text. A record without text, such as an image-only one, stays a turn but yields no
 * prompt, exactly as `sessionPrompts` reads the translated events.
 */
function promptTextOf(rec: ClaudeCodeRecordValue): string {
  const content = rec.message?.content;
  if (typeof content === "string") {
    return content;
  }
  if (!Array.isArray(content)) {
    return "";
  }
  for (const block of content) {
    if (block?.type === "text" && block.text) {
      return block.text;
    }
  }
  return "";
}

/**
 * The SessionSummary of one Claude Code session, translated straight from its records in `mergeByTimeStream` order
 * with the result `foldTranscript(translateClaudeCodeRecords(...))` gives: the same record-level rules
 * (`parseClaudeCodeRecord`, `userFlags`, `claudeCodeRequestKey`, `claudeCodeRequestUsage`, `claudeCodeUsageOf`,
 * `promptSnapshotPayload`), only the running numbers kept. No transcript, event or payload text is held; the state
 * is the usage of each request key and the lanes that emitted an event, so it grows with requests and subagents,
 * never with the session's size.
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
  /** The usage of each request key, in the order the keys were first seen; the entries alias `totals.usage`. */
  const requests = new Map<string, { inputTokens?: number; outputTokens?: number }>();
  /** The lanes of the records that translated to an event; each becomes a subagent lane. */
  const lanes = new Set<string>();
  const prompts = options.prompts === undefined ? undefined : ([] as SessionPrompt[]);
  const limit = options.prompts?.limit ?? 0;
  const maxChars = options.prompts?.maxChars ?? 0;

  const mergeRequest = (rec: ClaudeCodeRecordValue): void => {
    const key = claudeCodeRequestKey(rec);
    if (key === undefined) {
      return;
    }
    let entry = requests.get(key);
    if (entry === undefined) {
      // One request event per key, at its first record: the count is the number of keys.
      entry = {};
      requests.set(key, entry);
      totals.usage.push(entry);
      totals.requests += 1;
    }
    // Later records update the usage by `claudeCodeRequestUsage`; only its counts land in the entry.
    const chosen = claudeCodeRequestUsage(entry, claudeCodeUsageOf(rec.message?.usage));
    if (chosen !== undefined) {
      entry.inputTokens = typeof chosen.inputTokens === "number" ? chosen.inputTokens : undefined;
      entry.outputTokens = typeof chosen.outputTokens === "number" ? chosen.outputTokens : undefined;
    }
  };

  for await (const { record } of stamped) {
    const rec = parseClaudeCodeRecord(record.value);
    if (!rec) {
      return err(unknownFormatGeneration(AGENT, record));
    }
    let agentId = rec.agentId ?? options.agentForFile?.(record.file);
    if (rec.isSidechain) {
      agentId ??= "sidechain";
    }
    const type = rec.type;
    let emitted = false;

    if (type === "user" || type === "assistant") {
      emitted = true;
      mergeRequest(rec);
      // A tool result carries its error flag on its own block, whatever record type brought it.
      const content = rec.message?.content;
      if (Array.isArray(content)) {
        for (const block of content) {
          if (block?.type === "tool_result" && block.is_error === true) {
            totals.failedTools += 1;
          }
        }
      }
      if (type === "user" && (agentId === undefined || agentId === MAIN_LANE_ID)) {
        const flags: ClaudeCodeUserFlags = userFlags(rec);
        if (isPromptFlags(flags) && emitsUserEvent(rec)) {
          totals.turns += 1;
          if (prompts !== undefined && prompts.length < limit) {
            const text = promptTextOf(rec);
            if (text !== "") {
              prompts.push({ text: text.slice(0, maxChars) });
            }
          }
        }
      }
    } else if (type === "system") {
      emitted = true;
      const subtype = rec.subtype ?? "system";
      if (subtype === "compact_boundary") {
        totals.compactions += 1;
      } else if (subtype === "turn_duration") {
        addTurnDuration(totals, rec.durationMs);
      }
    } else if (type === "attachment") {
      const attachment = rec.attachment;
      const attachmentType = attachment?.type ?? "";
      if (attachment !== undefined && attachmentType === "prompt_snapshot") {
        // The strict parse is the generation check: a snapshot of another shape is an unknown format generation,
        // exactly as the translation reports it. Its content is dropped.
        if (promptSnapshotPayload(attachment) === undefined) {
          return err(unknownFormatGeneration(AGENT, record));
        }
        emitted = true;
      } else if (attachmentType.startsWith("hook_")) {
        emitted = true;
      }
    } else if (type !== "custom-title" && type !== "ai-title" && type !== "summary" && !BOOKKEEPING.has(type)) {
      emitted = true;
    }

    if (emitted && agentId !== undefined && agentId !== MAIN_LANE_ID) {
      lanes.add(agentId);
    }
  }

  // `CLAUDE_CODE_CAPABILITIES` lists requests, usage, durations, compaction and subagents for every session.
  const declared = new Set<Capability>(CLAUDE_CODE_CAPABILITIES);
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
      lanes.size
    )
  );
  return ok(prompts === undefined ? summary : { ...summary, prompts });
}
