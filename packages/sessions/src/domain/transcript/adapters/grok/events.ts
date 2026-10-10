import { err, ok, type Result } from "@rivus/agent-kit-catalog";

import {
  assignSeq,
  type Capability,
  inheritTimes,
  type Lane,
  markOrphanToolResults,
  type ParsedTranscript,
  shadowBefore,
  sourceOf,
  type SourcedRecord,
  type TranscriptSession,
  type UnknownFormatGeneration,
  unknownFormatGeneration
} from "../../index.js";
import type { GrokSessionMeta, GrokSubagentMeta } from "../../../session/adapters/grok/layout.js";
import { recordTime } from "../record-time.js";
import { applyGrokSubagents, createGrokTranslation } from "./translation.js";

const AGENT = "grok";

/** Recorded by every Grok session. */
const BASE_CAPABILITIES: readonly Capability[] = [
  "requests",
  "usage",
  "durations",
  "reasoning",
  "compaction",
  "compactionTokens",
  "subagents",
  "hooks"
];

/**
 * Everything a Grok transcript can list. `systemPrompt` and `toolSchemas` come from optional files beside
 * `updates.jsonl`, so a transcript lists them only when that session directory has them.
 */
export const GROK_CAPABILITIES: readonly Capability[] = [...BASE_CAPABILITIES, "systemPrompt", "toolSchemas"];

/** The capabilities one translated transcript shows. */
export function grokCapabilities(
  session: Pick<TranscriptSession, "systemPrompt" | "tools">,
  agents: readonly Pick<Lane, "systemPrompt">[]
): Capability[] {
  const out: Capability[] = [...BASE_CAPABILITIES];
  if (session.systemPrompt || agents.some((agent) => agent.systemPrompt)) {
    out.push("systemPrompt");
  }
  if (session.tools !== undefined) {
    out.push("toolSchemas");
  }
  return out;
}

export interface GrokTranslateOptions {
  /** Wins over the summary id when the summary names none. */
  sessionId?: string;
  meta?: GrokSessionMeta;
  /** `meta.json` of each `<session>/subagents/<id>/` directory, keyed by the directory name. */
  subagents?: ReadonlyMap<string, GrokSubagentMeta>;
}

/**
 * Translates one session's `updates.jsonl` records into transcript events. Grok records usage only per turn
 * (`turn_completed.usage` sums that turn's model calls), so each `request` is one turn: `granularity` is `turn`,
 * `modelCalls` is the count, and `usageByModel` is the per-model split. The request is placed before the turn's
 * first output. `elapsed_ms` is the turn duration and stays on a `turn_duration` marker.
 *
 * The record dispatch — chunk kinds, the injected-chunk rule, `continued` prompts by prompt index, the tool
 * merges, `turn_completed` requests and `elapsed_ms` durations, `auto_compact_*`, subagent ids — is
 * `createGrokTranslation`'s, which the summarize pass runs without retain; this function adds the time tracking,
 * the event identities' collision fallbacks and the passes after the loop.
 */
export function translateGrokRecords(
  records: readonly SourcedRecord[],
  options: GrokTranslateOptions = {}
): Result<ParsedTranscript, UnknownFormatGeneration> {
  const meta = options.meta ?? {};
  const translation = createGrokTranslation({ retain: true });
  let startedAt = meta.startedAt;
  let endedAt = meta.endedAt;
  const times = inheritTimes(records.map(recordTime));

  for (let index = 0; index < records.length; index++) {
    const record = records[index]!;
    const ts = times[index]!;
    const step = translation.step(record, ts);
    if (!step.ok) {
      return err(unknownFormatGeneration(AGENT, record));
    }
    startedAt = Math.min(startedAt ?? ts, ts);
    endedAt = Math.max(endedAt ?? ts, ts);
  }

  const events = [...translation.events];
  for (const compaction of events) {
    if (compaction.kind === "compaction") {
      shadowBefore(events, compaction);
    }
  }
  const agents = [...translation.agents];
  applyGrokSubagents(agents, options.subagents);
  markOrphanToolResults(events);
  assignSeq(events);
  const skipped = translation.skipped.map(({ reason, record }) => ({ reason, source: sourceOf(record) }));

  const session: TranscriptSession = {
    id: meta.id ?? options.sessionId ?? "unknown",
    ...(meta.title ? { title: meta.title } : {}),
    ...(meta.cwd ? { cwd: meta.cwd } : {}),
    ...(startedAt === undefined ? {} : { startedAt }),
    ...(endedAt === undefined ? {} : { endedAt }),
    ...(meta.systemPrompt ? { systemPrompt: meta.systemPrompt } : {}),
    ...(meta.tools === undefined ? {} : { tools: meta.tools })
  };
  return ok({ events, skipped, session, agents });
}
