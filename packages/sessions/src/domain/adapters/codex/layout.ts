import type { AgentHome } from "@rivus/agent-kit-catalog";

import { basenamePath, joinPath } from "../../session/index.js";

// Codex writes one rollout file per session, `rollout-<time>-<id>.jsonl`, under `<home>/sessions/YYYY/MM/DD/`, and
// moves older ones into `<home>/archived_sessions/`. A forked or subagent session is a rollout of its own.

/** Both directories: listing only `sessions/` misses every archived session. */
export function codexRoots(home: AgentHome): string[] {
  return [joinPath(home.path, "sessions"), joinPath(home.path, "archived_sessions")];
}

/** How listing walks a root: rollout files at any date depth. */
export const CODEX_SESSION_FILES: { match(name: string): boolean; maxDepth: number } = {
  match: isRolloutName,
  maxDepth: 6
};

/** The rollout file name without `.jsonl`, the session's fallback id. */
export function codexSessionStem(sessionPath: string): string {
  return basenamePath(sessionPath).replace(/\.jsonl$/, "");
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

function isRolloutName(name: string): boolean {
  return name.startsWith("rollout-") && name.endsWith(".jsonl");
}
