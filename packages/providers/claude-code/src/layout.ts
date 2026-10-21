import {
  CLAUDE_CODE_HOME_DIR,
  CLAUDE_CODE_PROJECTS_DIR,
  CLAUDE_CODE_SUBAGENTS_DIR,
  CLAUDE_CODE_SESSION_SUFFIX,
  CLAUDE_CODE_SESSION_SUFFIX_PATTERN,
  CLAUDE_CODE_META_SUFFIX,
  CLAUDE_CODE_AGENT_FILE_START,
  CLAUDE_CODE_AGENT_FILE_PREFIX
} from "./facts.js";
import type { AgentHome } from "@rivus/agent-kit-catalog/spi";
import * as z from "zod/mini";

import { basenamePath, belowRoot, dirnamePath, joinPath } from "@rivus/agent-kit-sessions/spi";
import { lenient } from "@rivus/agent-kit-sessions/spi";

// Claude Code keeps one JSONL file per session under `<home>/projects/<project>/<session>.jsonl`. Subagent
// transcripts live in `<project>/<session>/subagents/` (workflows nest one level deeper) as `agent-<id>.jsonl`,
// each with an optional `agent-<id>.meta.json`.

export function claudeCodeRoots(home: AgentHome): string[] {
  return [joinPath(home.path, CLAUDE_CODE_PROJECTS_DIR)];
}

/** How listing walks a root: session files, never the subagent directories. */
export const CLAUDE_CODE_SESSION_FILES: {
  match(name: string): boolean;
  skipDir(name: string): boolean;
  maxDepth: number;
} = {
  match: (name) => name.endsWith(CLAUDE_CODE_SESSION_SUFFIX),
  skipDir: (name) => name === CLAUDE_CODE_SUBAGENTS_DIR,
  maxDepth: 6
};

/** Depth of the walk under a session's subagent directory. */
export const CLAUDE_CODE_SUBAGENT_DEPTH = 8;

/** The session file name without `.jsonl`; it names the session's companion directory and is its fallback id. */
export function claudeCodeSessionStem(sessionPath: string): string {
  return basenamePath(sessionPath).replace(CLAUDE_CODE_SESSION_SUFFIX_PATTERN, "");
}

export function claudeCodeSubagentDir(sessionPath: string): string {
  return joinPath(joinPath(dirnamePath(sessionPath), claudeCodeSessionStem(sessionPath)), CLAUDE_CODE_SUBAGENTS_DIR);
}

export type ClaudeCodeSubagentFile = "transcript" | "meta" | "other";

/** `agent-*.jsonl` is a subagent transcript, `agent-*.meta.json` its metadata; anything else holds no records. */
export function claudeCodeSubagentFile(name: string): ClaudeCodeSubagentFile {
  if (name.startsWith(CLAUDE_CODE_AGENT_FILE_START) && name.endsWith(CLAUDE_CODE_META_SUFFIX)) {
    return "meta";
  }
  return name.startsWith(CLAUDE_CODE_AGENT_FILE_START) && name.endsWith(CLAUDE_CODE_SESSION_SUFFIX)
    ? "transcript"
    : "other";
}

/** The metadata file of a subagent transcript at `transcriptPath`. */
export function claudeCodeMetaPath(transcriptPath: string): string {
  return `${transcriptPath.slice(0, -CLAUDE_CODE_SESSION_SUFFIX.length)}${CLAUDE_CODE_META_SUFFIX}`;
}

/** The `agentId` a subagent transcript's records carry, read one record at a time until one names it. */
const AgentIdRecord = z.looseObject({ agentId: lenient(z.string()) });

/** The `agentId` one record names, or `undefined`; what `claudeCodeAgentIdFromFile` reads per record. */
export function claudeCodeAgentIdOfRecord(value: unknown): string | undefined {
  return z.safeParse(AgentIdRecord, value).data?.agentId;
}

/** A subagent's lane id: the `agentId` its records carry, else the file name after `agent-`. */
export function claudeCodeAgentIdFromFile(path: string, records: readonly { value: unknown }[]): string {
  for (const record of records) {
    const id = claudeCodeAgentIdOfRecord(record.value);
    if (id) {
      return id;
    }
  }
  const base = basenamePath(path).replace(CLAUDE_CODE_SESSION_SUFFIX_PATTERN, "");
  return base.startsWith(CLAUDE_CODE_AGENT_FILE_PREFIX) ? base.slice(CLAUDE_CODE_AGENT_FILE_PREFIX.length) : base;
}

/** Fields of `agent-<id>.meta.json`. */
export interface ClaudeCodeAgentMeta {
  title?: string;
  toolUseId?: string;
  parentAgentId?: string;
}

const AgentMeta = z.looseObject({
  description: lenient(z.string()),
  toolUseId: lenient(z.string()),
  parentAgentId: lenient(z.string())
});

export function claudeCodeAgentMeta(value: unknown): ClaudeCodeAgentMeta {
  const meta = z.safeParse(AgentMeta, value).data;
  return {
    ...(meta?.description ? { title: meta.description } : {}),
    ...(meta?.toolUseId ? { toolUseId: meta.toolUseId } : {}),
    ...(meta?.parentAgentId ? { parentAgentId: meta.parentAgentId } : {})
  };
}

/** A path under the default projects directory, or a head that reads like a Claude Code session. */
export function looksLikeClaudeCodeSession(path: string, head: string | undefined): boolean {
  if (path.includes(`/${CLAUDE_CODE_HOME_DIR}/${CLAUDE_CODE_PROJECTS_DIR}/`)) {
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
  match: (name) => name.endsWith(CLAUDE_CODE_SESSION_SUFFIX),
  maxDepth: 2 + CLAUDE_CODE_SUBAGENT_DEPTH
};

/**
 * What a usage decoder needs to know about a file of the walk, or `undefined` for a file below a subagent directory
 * that is not a transcript: a subagent transcript belongs to the session whose directory holds it, and its lane is
 * named by its file.
 */
export function claudeCodeUsageFile(path: string): { sessionId: string; agentLaneId?: string } | undefined {
  const at = path.lastIndexOf(`/${CLAUDE_CODE_SUBAGENTS_DIR}/`);
  if (at < 0) {
    return { sessionId: claudeCodeSessionStem(path) };
  }
  if (claudeCodeSubagentFile(basenamePath(path)) !== "transcript") {
    return undefined;
  }
  return { sessionId: basenamePath(path.slice(0, at)), agentLaneId: claudeCodeAgentIdFromFile(path, []) };
}

/**
 * A usage source's identity: the path below its project directory. Session ids are unique, and the project directory
 * is named after a working directory that can move.
 */
export function claudeCodeUsageSourceId(path: string, root: string): string {
  const below = belowRoot(path, root);
  return below.slice(below.indexOf("/") + 1);
}

/**
 * What a decode of a target file knows besides its records: the file's session and lane when it is one of the walk's
 * files, and no session (`unknown`) for a target below a subagent directory that is not a transcript.
 */
export function claudeCodeUsageTarget(path: string): { sessionId: string; agentLaneId?: string } {
  return claudeCodeUsageFile(path) ?? { sessionId: "unknown" };
}
