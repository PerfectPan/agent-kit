import type { AgentHome } from "@rivus/agent-kit-catalog/spi";
import {
  basenamePath,
  dirnamePath,
  joinPath,
  type SessionPlatform,
  type WalkSpec
} from "@rivus/agent-kit-sessions/spi";

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
function dshVersionOf(path: string): number | undefined {
  const match = /^session(?:\.v(\d+))?\.jsonl(?:\.zstd)?$/.exec(basenamePath(path));
  if (match === null) {
    return undefined;
  }
  return match[1] === undefined ? 0 : Number(match[1]);
}

/**
 * After a format migration both generations stay in the `<id>` directory (`resolveGenerationInDirectory` in
 * dsh-session-persistence-jsonl selects the numerically highest one, and the migration publishes the new file
 * without removing the old), so only the highest generation counts. The maximum per directory is computed once,
 * not per path. Discovery and the usage decoder share this keeper so a file one side lists is one the other reads.
 */
export function latestGenerationKeeper(): (path: string, all: ReadonlySet<string>) => boolean {
  let listed: ReadonlySet<string> | undefined;
  let highest = new Map<string, number>();
  return (path, all) => {
    if (all !== listed) {
      listed = all;
      highest = new Map<string, number>();
      for (const candidate of all) {
        const dir = dirnamePath(candidate);
        highest.set(dir, Math.max(highest.get(dir) ?? -1, dshVersionOf(candidate) ?? -1));
      }
    }
    return (dshVersionOf(path) ?? -1) === (highest.get(dirnamePath(path)) ?? -1);
  };
}

/** The session id a file's records name when the header names none: the `<id>` directory the file lives in. */
export function dshSessionIdOf(path: string): string {
  return basenamePath(dirnamePath(path));
}

function isSafeChildId(childId: string): boolean {
  return childId.length > 0 && childId !== "." && childId !== ".." && !childId.includes("/") && !childId.includes("\\");
}

/** The highest-generation session log inside `<dir>`, preferring compressed when both formats exist at one version. */
async function latestLogInDir(
  platform: SessionPlatform,
  dir: string,
  signal: AbortSignal | undefined
): Promise<string | undefined> {
  signal?.throwIfAborted();
  let entries;
  try {
    if ((await platform.fs.stat(dir, { followSymlinks: true }))?.kind !== "dir") {
      return undefined;
    }
    entries = await platform.fs.list(dir);
  } catch {
    signal?.throwIfAborted();
    return undefined;
  }
  const candidates: string[] = [];
  for (const entry of entries) {
    if (entry.kind === "file" && DSH_SESSION_FILES.match(entry.name)) {
      candidates.push(joinPath(dir, entry.name));
    }
  }
  if (candidates.length === 0) {
    return undefined;
  }
  const keep = latestGenerationKeeper();
  const all = new Set(candidates);
  const newest = candidates.filter((candidate) => keep(candidate, all));
  return newest.find((candidate) => dshIsCompressed(candidate)) ?? newest[0];
}

/**
 * Resolves a local child session id to its session log under the same `DSH_HOME/sessions/` tree: checks the parent's
 * own project directory first, then falls back to sibling project directories when the child's cwd differs.
 */
export async function resolveDshChildPath(
  platform: SessionPlatform,
  parentPath: string,
  childId: string,
  signal?: AbortSignal
): Promise<string | undefined> {
  if (!isSafeChildId(childId)) {
    return undefined;
  }
  const parentSessionDir = dirnamePath(parentPath);
  const projectDir = dirnamePath(parentSessionDir);
  const sameProject = await latestLogInDir(platform, joinPath(projectDir, childId), signal);
  if (sameProject !== undefined) {
    return sameProject;
  }
  const sessionsRoot = dirnamePath(projectDir);
  if (sessionsRoot === projectDir) {
    return undefined;
  }
  let projects;
  try {
    if ((await platform.fs.stat(sessionsRoot, { followSymlinks: true }))?.kind !== "dir") {
      return undefined;
    }
    projects = await platform.fs.list(sessionsRoot);
  } catch {
    signal?.throwIfAborted();
    return undefined;
  }
  const parentProjectName = basenamePath(projectDir);
  for (const entry of projects) {
    signal?.throwIfAborted();
    if (entry.kind !== "dir" || entry.name === parentProjectName) {
      continue;
    }
    const found = await latestLogInDir(platform, joinPath(joinPath(sessionsRoot, entry.name), childId), signal);
    if (found !== undefined) {
      return found;
    }
  }
  return undefined;
}
