import { PlatformService } from "@rivus/agent-kit-platform/effect";
import * as Effect from "effect/Effect";

import type { ArtifactIoFailure } from "../ports.js";

const separator = (path: string, isWin: boolean): number =>
  isWin ? Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\")) : path.lastIndexOf("/");

const isAbsolute = (path: string, isWin: boolean): boolean =>
  path.startsWith("/") || (isWin && /^[A-Za-z]:[\\/]/.test(path));

function normalizeAbsolute(path: string, isWin: boolean): string {
  const drive = isWin ? (/^[A-Za-z]:/.exec(path)?.[0] ?? "") : "";
  const root = drive ? `${drive}/` : "/";
  const split = isWin ? /[\\/]+/ : /\/+/;
  const stack: string[] = [];
  for (const part of path.slice(drive.length).split(split)) {
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
    const { fs, os } = yield* PlatformService;
    const isWin = os === "win32";
    const trailingSep = isWin ? /[\\/]$/ : /\/$/;
    const resolve = async (target: string, followLast: boolean): Promise<string> => {
      if (followLast) {
        const real = await fs.realpath(target);
        if (real !== undefined) {
          return real;
        }
      }
      const cut = separator(target, isWin);
      if (cut <= 0) {
        return target;
      }
      const parent = await resolve(target.slice(0, cut), true);
      return `${parent.replace(trailingSep, "")}/${target.slice(cut + 1)}`;
    };
    const start = async (): Promise<string> => {
      let target = path;
      if (!isAbsolute(target, isWin)) {
        const cwd = await fs.realpath(".");
        if (cwd !== undefined) {
          target = normalizeAbsolute(`${cwd}/${target}`, isWin);
        }
      }
      const resolved = await resolve(target, follow);
      if (!isAbsolute(resolved, isWin)) {
        return resolved;
      }
      const normalized = normalizeAbsolute(resolved, isWin);
      if (normalized !== resolved) {
        return resolve(normalized, follow);
      }
      return normalized;
    };
    return yield* Effect.tryPromise({ try: start, catch: (cause) => resolveIo(path, cause) });
  });
}
