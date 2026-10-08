import { type AgentHome, err, ok, type Result } from "@rivus/agent-kit-catalog";

import { dirnamePath, joinPath } from "../../session/index.js";
import {
  type SourcePointer,
  timeOf,
  type UnknownFormatGeneration,
  unknownFormatGeneration
} from "../../transcript/index.js";
import { asNumber, asRecord, asString } from "../../protocols/record-fields.js";

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

/** Fields of `subagents/<id>/meta.json` that name the lane. */
export interface GrokSubagentMeta {
  id?: string;
  title?: string;
}

export function grokSubagentMeta(value: unknown): GrokSubagentMeta {
  const meta = asRecord(value);
  const out: GrokSubagentMeta = {};
  const id = asString(meta?.subagent_id);
  const title = asString(meta?.description);
  if (id) {
    out.id = id;
  }
  if (title) {
    out.title = title;
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
 * Fields of `summary.json`. `chat_format_version` other than 1 is an unknown generation. A missing version is the
 * generation this adapter reads.
 */
export function grokSummaryFields(
  value: unknown,
  source: SourcePointer
): Result<GrokSessionMeta, UnknownFormatGeneration> {
  const summary = asRecord(value) ?? {};
  const format = asNumber(summary.chat_format_version);
  if (format !== undefined && format !== 1) {
    return err(unknownFormatGeneration("grok", source));
  }
  const info = asRecord(summary.info);
  const meta: GrokSessionMeta = {};
  const id = asString(info?.id);
  const cwd = asString(info?.cwd);
  const title = asString(summary.generated_title) ?? asString(summary.session_summary);
  const startedAt = timeOf(summary.created_at);
  const endedAt = timeOf(summary.last_active_at);
  const model = asString(summary.current_model_id);
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
