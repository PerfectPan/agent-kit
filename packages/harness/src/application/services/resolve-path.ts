import { PlatformService } from "@rivus/agent-kit-platform/effect";
import * as Effect from "effect/Effect";

import type { ArtifactIoFailure } from "../ports.js";

const separator = (path: string): number => Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));

const isAbsolute = (path: string): boolean => path.startsWith("/") || /^[A-Za-z]:[\\/]/.test(path);

function normalizeAbsolute(path: string): string {
  const drive = /^[A-Za-z]:/.exec(path)?.[0] ?? "";
  const root = drive ? `${drive}/` : "/";
  const stack: string[] = [];
  for (const part of path.slice(drive.length).split(/[\\/]+/)) {
    if (part === "" || part === ".") {
      continue;
    }
    if (part === "..") {
      stack.pop();
    } else {
      stack.push(part);
    }
  }
  return stack.length === 0 ? root : `${root}${stack.join("/")}`;
}

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
    const start = async (): Promise<string> => {
      let target = path;
      if (!isAbsolute(target)) {
        const cwd = await fs.realpath(".");
        if (cwd !== undefined) {
          target = normalizeAbsolute(`${cwd}/${target}`);
        }
      }
      const resolved = await resolve(target, follow);
      if (!isAbsolute(resolved)) {
        return resolved;
      }
      const normalized = normalizeAbsolute(resolved);
      if (normalized !== resolved) {
        return resolve(normalized, follow);
      }
      return normalized;
    };
    return yield* Effect.tryPromise({ try: start, catch: (cause) => resolveIo(path, cause) });
  });
}
