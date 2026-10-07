import type { AgentHome } from "@rivus/agent-kit-catalog";

import { basenamePath, joinPath } from "../../domain/session/index.js";

// Pi keeps one JSONL file per session under `<home>/sessions/<encoded cwd>/<time>_<id>.jsonl`. The first record is a
// `session` header; a session forked or branched from another names it in `parentSession` and starts with a copy of
// that session's entries, which keep their own timestamps.

export function piUsageRoots(home: AgentHome): string[] {
  return [joinPath(home.path, "sessions")];
}

export const PI_SESSION_FILES: { match(name: string): boolean; maxDepth: number } = {
  match: (name) => name.endsWith(".jsonl"),
  maxDepth: 2
};

/** The file name without `.jsonl` and the time prefix, the session's fallback id. */
export function piSessionStem(path: string): string {
  const stem = basenamePath(path).replace(/\.jsonl$/, "");
  const cut = stem.lastIndexOf("_");
  return cut < 0 ? stem : stem.slice(cut + 1);
}
