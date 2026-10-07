import { err, ok, type Result } from "@rivus/agent-kit-catalog";

import type { ReadFailed, SessionNotFound } from "../../domain/session/index.js";
import type { SessionPlatform } from "../ports.js";

/** Errno codes of file system failures a read can meet. Any other error is a defect and is not turned into a value. */
const FS_ERRNO = new Set([
  "EACCES",
  "EAGAIN",
  "EBUSY",
  "EIO",
  "EISDIR",
  "ELOOP",
  "EMFILE",
  "ENAMETOOLONG",
  "ENFILE",
  "ENODEV",
  "ENOENT",
  "ENOTDIR",
  "ENXIO",
  "EPERM",
  "ESTALE",
  "ETIMEDOUT"
]);

/** A view of a platform whose file system errors can be told from other errors, and turned into values. */
export interface GuardedIo {
  readonly platform: SessionPlatform;
  /** `SessionNotFound` for `ENOENT`, `ReadFailed` for another errno, `undefined` for an error not from the view. */
  failure(error: unknown, path: string): SessionNotFound | ReadFailed | undefined;
}

/**
 * A view of `platform` that marks the file system errors of its `stat`, `list` and `read`. Only errors thrown by those
 * calls count, so a caller's callback that throws, or a defect with some other `code`, is not a failure value.
 */
export function guardIo(platform: SessionPlatform): GuardedIo {
  const fsErrors = new WeakSet<object>();
  const mark = (error: unknown): never => {
    if (typeof error === "object" && error !== null && FS_ERRNO.has(String((error as { code?: unknown }).code))) {
      fsErrors.add(error);
    }
    throw error;
  };
  const { fs } = platform;
  return {
    platform: {
      fs: {
        stat: (target, options) => fs.stat(target, options).catch(mark),
        list: (dir) => fs.list(dir).catch(mark),
        async *read(target, range) {
          try {
            yield* fs.read(target, range);
          } catch (error) {
            mark(error);
          }
        }
      }
    },
    failure(error, path) {
      return typeof error === "object" && error !== null && fsErrors.has(error) ? classify(error, path) : undefined;
    }
  };
}

/**
 * Runs `read` against a view of `platform` and turns the file system errors of that view's `stat`, `list` and `read`
 * into values: `ENOENT` is `SessionNotFound`, another errno is `ReadFailed`. Only errors thrown by those calls count,
 * so a caller's callback that throws, or a defect with some other `code`, still rejects. An abort rejects with
 * `signal.reason`.
 */
export async function catchIoFailure<T>(
  platform: SessionPlatform,
  path: string,
  signal: AbortSignal | undefined,
  read: (platform: SessionPlatform) => Promise<T>
): Promise<Result<T, SessionNotFound | ReadFailed>> {
  const io = guardIo(platform);
  try {
    return ok(await read(io.platform));
  } catch (error) {
    signal?.throwIfAborted();
    const failure = io.failure(error, path);
    if (!failure) {
      throw error;
    }
    return err(failure);
  }
}

function classify(error: object, path: string): SessionNotFound | ReadFailed {
  const { code, path: errorPath } = error as { code: string; path?: unknown };
  const at = typeof errorPath === "string" ? errorPath : path;
  if (code === "ENOENT") {
    return { _tag: "SessionNotFound", path: at };
  }
  return { _tag: "ReadFailed", path: at, message: error instanceof Error ? error.message : code, cause: error };
}
