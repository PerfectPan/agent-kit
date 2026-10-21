import {
  CODEX_ROLLOUT_PREFIX,
  CODEX_SESSION_SUFFIX,
  CODEX_SESSIONS_DIR,
  CODEX_ARCHIVED_SESSIONS_DIR,
  CODEX_SESSION_SUFFIX_PATTERN
} from "./facts.js";
import { type AgentHome } from "@rivus/agent-kit-catalog/spi";
import { basenamePath, joinPath } from "@rivus/agent-kit-sessions/spi";

// Codex writes one rollout file per session, `rollout-<time>-<id>.jsonl`, under `<home>/sessions/YYYY/MM/DD/`, and
// moves older ones into `<home>/archived_sessions/`. A forked or subagent session is a rollout of its own.

function isRolloutName(name: string): boolean {
  return name.startsWith(CODEX_ROLLOUT_PREFIX) && name.endsWith(CODEX_SESSION_SUFFIX);
}

/** Both directories: listing only `sessions/` misses every archived session. */
export function codexRoots(home: AgentHome): string[] {
  return [joinPath(home.path, CODEX_SESSIONS_DIR), joinPath(home.path, CODEX_ARCHIVED_SESSIONS_DIR)];
}

/** How listing walks a root: rollout files at any date depth. */
export const CODEX_SESSION_FILES: { match(name: string): boolean; maxDepth: number } = {
  match: isRolloutName,
  maxDepth: 6
};

/** The rollout file name without `.jsonl`, the session's fallback id. */
export function codexSessionStem(sessionPath: string): string {
  return basenamePath(sessionPath).replace(CODEX_SESSION_SUFFIX_PATTERN, "");
}

/** A rollout's identity as a usage source: its file name, which archiving from `sessions/` to `archived_sessions/` keeps. */
export function codexUsageSourceId(path: string): string {
  return basenamePath(path);
}

/** A rollout file name, or a head that starts with a `session_meta` record. */
export function looksLikeCodexSession(path: string, head: string | undefined): boolean {
  if (isRolloutName(basenamePath(path))) {
    return true;
  }
  return head !== undefined && head.slice(0, 2000).includes('"session_meta"');
}
