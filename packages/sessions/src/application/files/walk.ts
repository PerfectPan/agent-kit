import { joinPath } from "../../domain/session/index.js";
import type { SessionPlatform } from "../ports.js";

/** Which files under a directory a walk returns. Symlinks are not followed, so a link cycle cannot trap it. */
export interface WalkSpec {
  match(name: string): boolean;
  skipDir?(name: string): boolean;
  /** Directory levels below the start that the walk enters. */
  maxDepth: number;
}

export interface WalkOptions {
  readonly signal?: AbortSignal;
  /**
   * Called for a directory below `dir` that cannot be listed; the walk then goes on without it. Without it, that
   * error rejects the walk. An error listing `dir` itself always rejects.
   */
  readonly onError?: (dir: string, error: unknown) => void;
}

/** Paths of the matching files under `dir`, depth first in listing order. */
export async function walkFiles(
  platform: SessionPlatform,
  dir: string,
  spec: WalkSpec,
  options: WalkOptions = {}
): Promise<string[]> {
  const out: string[] = [];
  const walk = async (current: string, depth: number): Promise<void> => {
    options.signal?.throwIfAborted();
    let entries: Awaited<ReturnType<SessionPlatform["fs"]["list"]>>;
    try {
      entries = await platform.fs.list(current);
    } catch (error) {
      if (current === dir || !options.onError || options.signal?.aborted) {
        throw error;
      }
      options.onError(current, error);
      return;
    }
    for (const entry of entries) {
      if (entry.kind === "dir" && spec.skipDir?.(entry.name)) {
        continue;
      }
      const path = joinPath(current, entry.name);
      if (entry.kind === "file" && spec.match(entry.name)) {
        out.push(path);
      } else if (entry.kind === "dir" && depth < spec.maxDepth) {
        await walk(path, depth + 1);
      }
    }
  };
  await walk(dir, 0);
  return out;
}
