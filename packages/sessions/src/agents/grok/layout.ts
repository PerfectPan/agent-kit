import type { AgentHome } from "@rivus/agent-kit-catalog";

import { dirnamePath, joinPath } from "../../domain/session/index.js";
import { asRecord, asString } from "../record-fields.js";

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
