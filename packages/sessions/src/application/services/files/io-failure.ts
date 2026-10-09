import { err, ok, type Result } from "@rivus/agent-kit-catalog";
import * as z from "zod/mini";

import type { ReadFailed, SessionNotFound } from "../../../domain/session/index.js";
import { lenient } from "../../../domain/transcript/adapters/lenient.js";
import type { SessionPlatform } from "../../ports.js";

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

/** The shape of a file system error: a string `code`, and the `path` it failed on. A `path` of any other shape counts
 * as absent, so the caller's path wins, as before. */
const FsError = z.object({
  code: z.string(),
  path: lenient(z.string())
});

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
    const fs = z.safeParse(FsError, error).data;
    if (fs !== undefined && FS_ERRNO.has(fs.code)) {
      // The parse only succeeds for objects, so the error is one the `WeakSet` can hold.
      fsErrors.add(error as object);
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
      const fs = z.safeParse(FsError, error).data;
      if (fs === undefined || !fsErrors.has(error as object)) {
        return undefined;
      }
      const at = fs.path ?? path;
      if (fs.code === "ENOENT") {
        return { _tag: "SessionNotFound", path: at };
      }
      return { _tag: "ReadFailed", path: at, message: error instanceof Error ? error.message : fs.code, cause: error };
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
