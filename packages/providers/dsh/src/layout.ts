import type { AgentHome } from "@rivus/agent-kit-catalog/spi";
import { basenamePath, dirnamePath, joinPath, type WalkSpec } from "@rivus/agent-kit-sessions/spi";

import { DSH_SESSIONS_DIR } from "./facts.js";

/**
 * One session directory per project, one session directory per id, and one current-generation file inside it:
 * `<root>/--<cwd>--/<id>/session.v4.jsonl.zstd` (or `session.v4.jsonl` when compression is off). `maxDepth` reaches
 * the file from the sessions root.
 */
export const DSH_SESSION_FILES: WalkSpec = {
  match: (name) => /^session(?:\.v\d+)?\.jsonl(?:\.zstd)?$/.test(name),
  maxDepth: 3
};

export function dshRoots(home: AgentHome): string[] {
  return [joinPath(home.path, DSH_SESSIONS_DIR)];
}

export function dshIsCompressed(path: string): boolean {
  return path.endsWith(".zstd");
}

/** The generation the file name names: `session.vN.…` is N, the unsuffixed `session.jsonl` was v0. */
export function dshVersionOf(path: string): number | undefined {
  const match = /^session(?:\.v(\d+))?\.jsonl(?:\.zstd)?$/.exec(basenamePath(path));
  if (match === null) {
    return undefined;
  }
  return match[1] === undefined ? 0 : Number(match[1]);
}

/** The session id a file's records name when the header names none: the `<id>` directory the file lives in. */
export function dshSessionIdOf(path: string): string {
  return basenamePath(dirnamePath(path));
}
