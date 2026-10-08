import type { AgentHome } from "@rivus/agent-kit-catalog";

import { basenamePath, dirnamePath, joinPath } from "../../session/index.js";
import { asRecord, asString } from "../../protocols/record-fields.js";

// Claude Code keeps one JSONL file per session under `<home>/projects/<project>/<session>.jsonl`. Subagent
// transcripts live in `<project>/<session>/subagents/` (workflows nest one level deeper) as `agent-<id>.jsonl`,
// each with an optional `agent-<id>.meta.json`.

export function claudeCodeRoots(home: AgentHome): string[] {
  return [joinPath(home.path, "projects")];
}

/** How listing walks a root: session files, never the subagent directories. */
export const CLAUDE_CODE_SESSION_FILES: {
  match(name: string): boolean;
  skipDir(name: string): boolean;
  maxDepth: number;
} = {
  match: (name) => name.endsWith(".jsonl"),
  skipDir: (name) => name === SUBAGENTS,
  maxDepth: 6
};

/** Depth of the walk under a session's subagent directory. */
export const CLAUDE_CODE_SUBAGENT_DEPTH = 8;

const SUBAGENTS = "subagents";

/** The session file name without `.jsonl`; it names the session's companion directory and is its fallback id. */
export function claudeCodeSessionStem(sessionPath: string): string {
  return basenamePath(sessionPath).replace(/\.jsonl$/, "");
}

export function claudeCodeSubagentDir(sessionPath: string): string {
  return joinPath(joinPath(dirnamePath(sessionPath), claudeCodeSessionStem(sessionPath)), SUBAGENTS);
}

export type ClaudeCodeSubagentFile = "transcript" | "meta" | "other";

/** `agent-*.jsonl` is a subagent transcript, `agent-*.meta.json` its metadata; anything else holds no records. */
export function claudeCodeSubagentFile(name: string): ClaudeCodeSubagentFile {
  if (name.startsWith("agent") && name.endsWith(".meta.json")) {
    return "meta";
  }
  return name.startsWith("agent") && name.endsWith(".jsonl") ? "transcript" : "other";
}

/** The metadata file of a subagent transcript at `transcriptPath`. */
export function claudeCodeMetaPath(transcriptPath: string): string {
  return `${transcriptPath.slice(0, -".jsonl".length)}.meta.json`;
}

/** A subagent's lane id: the `agentId` its records carry, else the file name after `agent-`. */
export function claudeCodeAgentIdFromFile(path: string, records: readonly { value: unknown }[]): string {
  for (const record of records) {
    const id = asString(asRecord(record.value)?.agentId);
    if (id) {
      return id;
    }
  }
  const base = basenamePath(path).replace(/\.jsonl$/, "");
  return base.startsWith("agent-") ? base.slice("agent-".length) : base;
}

/** Fields of `agent-<id>.meta.json`. */
export interface ClaudeCodeAgentMeta {
  title?: string;
  toolUseId?: string;
  parentAgentId?: string;
}

export function claudeCodeAgentMeta(value: unknown): ClaudeCodeAgentMeta {
  const meta = asRecord(value);
  const out: ClaudeCodeAgentMeta = {};
  const title = asString(meta?.description);
  const toolUseId = asString(meta?.toolUseId);
  const parentAgentId = asString(meta?.parentAgentId);
  if (title) {
    out.title = title;
  }
  if (toolUseId) {
    out.toolUseId = toolUseId;
  }
  if (parentAgentId) {
    out.parentAgentId = parentAgentId;
  }
  return out;
}

/** A path under the default projects directory, or a head that reads like a Claude Code session. */
export function looksLikeClaudeCodeSession(path: string, head: string | undefined): boolean {
  if (path.includes("/.claude/projects/")) {
    return true;
  }
  if (head === undefined) {
    return false;
  }
  const start = head.slice(0, 4000);
  const user = start.includes('"type":"user"') || start.includes('"type": "user"');
  const assistant = start.includes('"type":"assistant"') || start.includes('"type": "assistant"');
  return (user || assistant) && start.includes('"sessionId"');
}

/** How the usage walk finds a session's files: the session files, and the subagent transcripts below them. */
export const CLAUDE_CODE_USAGE_FILES: { match(name: string): boolean; maxDepth: number } = {
  match: (name) => name.endsWith(".jsonl"),
  maxDepth: 2 + CLAUDE_CODE_SUBAGENT_DEPTH
};

/**
 * What a usage decoder needs to know about a file of the walk, or `undefined` for a file below a subagent directory
 * that is not a transcript: a subagent transcript belongs to the session whose directory holds it, and its lane is
 * named by its file.
 */
export function claudeCodeUsageFile(path: string): { sessionId: string; agentLaneId?: string } | undefined {
  const at = path.lastIndexOf(`/${SUBAGENTS}/`);
  if (at < 0) {
    return { sessionId: claudeCodeSessionStem(path) };
  }
  if (claudeCodeSubagentFile(basenamePath(path)) !== "transcript") {
    return undefined;
  }
  return { sessionId: basenamePath(path.slice(0, at)), agentLaneId: claudeCodeAgentIdFromFile(path, []) };
}
