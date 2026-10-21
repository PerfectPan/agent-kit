import type { AgentHome } from "@rivus/agent-kit-catalog/spi";
import { basenamePath, joinPath } from "@rivus/agent-kit-sessions/spi";
import { PI_SESSIONS_DIR, PI_SESSION_SUFFIX, PI_SESSION_SUFFIX_PATTERN } from "./facts.js";

export const piSessionDirectory: string = PI_SESSIONS_DIR;

// Pi keeps one JSONL file per session under `<home>/sessions/<encoded cwd>/<time>_<id>.jsonl`. The first record is a
// `session` header; a session forked or branched from another names it in `parentSession` and starts with a copy of
// that session's entries, which keep their own timestamps.

export function piUsageRoots(home: AgentHome): string[] {
  return [joinPath(home.path, piSessionDirectory)];
}

export const PI_SESSION_FILES: { match(name: string): boolean; maxDepth: number } = {
  match: (name) => name.endsWith(PI_SESSION_SUFFIX),
  maxDepth: 2
};

/** The file name without `.jsonl` and the time prefix, the session's fallback id. */
export function piSessionStem(path: string): string {
  const stem = basenamePath(path).replace(PI_SESSION_SUFFIX_PATTERN, "");
  const cut = stem.lastIndexOf("_");
  return cut < 0 ? stem : stem.slice(cut + 1);
}
