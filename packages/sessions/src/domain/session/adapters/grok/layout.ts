import { type AgentHome, err, ok, type Result } from "@rivus/agent-kit-catalog";
import * as z from "zod/mini";

import { basenamePath, dirnamePath, joinPath } from "../../index.js";
import {
  type SourcePointer,
  timeOf,
  type UnknownFormatGeneration,
  unknownFormatGeneration
} from "../../../transcript/index.js";
import { lenient } from "../../../transcript/adapters/lenient.js";
import { logTimestamp } from "../../../transcript/adapters/timestamp.js";

// Grok keeps one directory per session under `<home>/sessions/<encoded-cwd>/<session-id>/`. The transcript is
// `updates.jsonl`. `summary.json`, `system_prompt.txt` and `tool_definitions.json` sit beside it. A subagent's
// `meta.json` lives in `<session>/subagents/<id>/` and is not itself a transcript.

const UPDATES = "updates.jsonl";
const SUBAGENTS = "subagents";

export function grokRoots(home: AgentHome): string[] {
  return [joinPath(home.path, "sessions")];
}

/** How listing walks a root: `updates.jsonl` files, never the subagent directories. */
export const GROK_SESSION_FILES: {
  match(name: string): boolean;
  skipDir(name: string): boolean;
  maxDepth: number;
} = {
  match: (name) => name === UPDATES,
  skipDir: (name) => name === SUBAGENTS,
  maxDepth: 8
};

/** The session directory of an `updates.jsonl` path, or `path` when it already is that directory. */
export function grokSessionDir(path: string): string {
  return path.endsWith(`/${UPDATES}`) || path === UPDATES ? dirnamePath(path) : path;
}

export function grokUpdatesPath(path: string): string {
  return path.endsWith(`/${UPDATES}`) || path === UPDATES ? path : joinPath(path, UPDATES);
}

export function grokSummaryPath(sessionDir: string): string {
  return joinPath(sessionDir, "summary.json");
}

/** A usage source's identity: its session directory's name. */
export function grokUsageSourceId(path: string): string {
  return basenamePath(grokSessionDir(path));
}

/** The session id of `updates.jsonl`: the one `summary.json` names, else the session directory's. */
export function grokUsageSessionId(summaryId: string | undefined, updatesPath: string): string {
  return summaryId ?? basenamePath(grokSessionDir(updatesPath));
}

/** Fields of `subagents/<id>/meta.json` that name the lane. */
export interface GrokSubagentMeta {
  id?: string;
  title?: string;
}

const SubagentMetaFile = z.looseObject({
  subagent_id: lenient(z.string()),
  description: lenient(z.string())
});

export function grokSubagentMeta(value: unknown): GrokSubagentMeta {
  const meta = z.safeParse(SubagentMetaFile, value).data;
  const out: GrokSubagentMeta = {};
  if (meta?.subagent_id) {
    out.id = meta.subagent_id;
  }
  if (meta?.description) {
    out.title = meta.description;
  }
  return out;
}

/** Fields of `summary.json` plus the optional side files the adapter reads. */
export interface GrokSessionMeta {
  id?: string;
  title?: string;
  cwd?: string;
  startedAt?: number;
  endedAt?: number;
  model?: string;
  systemPrompt?: string;
  tools?: unknown;
}

/**
 * Fields of `summary.json`, read leniently like every agent log. `created_at` and `last_active_at` may be epoch
 * seconds or a timestamp string, which `timeOf` tells apart.
 */
const SummaryFile = z.looseObject({
  chat_format_version: lenient(z.number()),
  generated_title: lenient(z.string()),
  session_summary: lenient(z.string()),
  current_model_id: lenient(z.string()),
  created_at: logTimestamp,
  last_active_at: logTimestamp,
  info: lenient(z.looseObject({ id: lenient(z.string()), cwd: lenient(z.string()) }))
});

/**
 * Fields of `summary.json`. `chat_format_version` other than 1 is an unknown generation. A missing version is the
 * generation this adapter reads.
 */
export function grokSummaryFields(
  value: unknown,
  source: SourcePointer
): Result<GrokSessionMeta, UnknownFormatGeneration> {
  const summary = z.safeParse(SummaryFile, value).data;
  const format = summary?.chat_format_version;
  if (format !== undefined && format !== 1) {
    return err(unknownFormatGeneration("grok", source));
  }
  const meta: GrokSessionMeta = {};
  const id = summary?.info?.id;
  const cwd = summary?.info?.cwd;
  const title = summary?.generated_title ?? summary?.session_summary;
  const startedAt = timeOf(summary?.created_at);
  const endedAt = timeOf(summary?.last_active_at);
  const model = summary?.current_model_id;
  if (id) {
    meta.id = id;
  }
  if (cwd) {
    meta.cwd = cwd;
  }
  if (title) {
    meta.title = title;
  }
  if (startedAt !== undefined) {
    meta.startedAt = startedAt;
  }
  if (endedAt !== undefined) {
    meta.endedAt = endedAt;
  }
  if (model) {
    meta.model = model;
  }
  return ok(meta);
}
