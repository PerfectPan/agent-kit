import { PlatformService } from "@rivus/agent-kit-platform/effect";
import * as Effect from "effect/Effect";

import type { ArtifactIoFailure } from "./ports.js";

const separator = (path: string): number => Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));

export function resolveIo(path: string, cause: unknown): ArtifactIoFailure {
  return { _tag: "ArtifactIoFailure", path, operation: "read", message: `cannot resolve ${path}`, cause };
}

/**
 * The path convention of ArtifactLocator: every directory above the last segment resolved by realpath (the nearest
 * existing one, when some do not exist yet), the last segment kept as it is. `follow` resolves the last segment too,
 * for a root directory.
 */
export function resolvePath(path: string, follow = false): Effect.Effect<string, ArtifactIoFailure, PlatformService> {
  return Effect.gen(function* () {
    const { fs } = yield* PlatformService;
    const resolve = async (target: string, followLast: boolean): Promise<string> => {
      if (followLast) {
        const real = await fs.realpath(target);
        if (real !== undefined) {
          return real;
        }
      }
      const cut = separator(target);
      if (cut <= 0) {
        return target;
      }
      const parent = await resolve(target.slice(0, cut), true);
      return `${parent.replace(/[\\/]$/, "")}/${target.slice(cut + 1)}`;
    };
    return yield* Effect.tryPromise({ try: () => resolve(path, follow), catch: (cause) => resolveIo(path, cause) });
  });
}
