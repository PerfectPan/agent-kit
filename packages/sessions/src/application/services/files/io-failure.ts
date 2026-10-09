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

/**
 * The fields of a file system error the guarded calls throw: the `code` it carries, and the `path` it failed on.
 * `code` stays the raw value and the errno test is `String(code)`, exactly as before, so a code that stringifies to
 * an errno (a `String` object, a one-element array) still marks its error. A `path` of any other shape counts as
 * absent, so the caller's path wins, as before.
 */
const FsError = z.object({
  code: z.unknown(),
  path: lenient(z.string())
});

/** The one field marking reads. Marking must not touch the rest of the error — classification reads `path` beside
 * `code`, but a property a host hangs on a non-fs error may throw, and the original error has to win. */
const MarkedError = z.object({ code: z.unknown() });

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
    const marked = z.safeParse(MarkedError, error).data;
    if (marked !== undefined && FS_ERRNO.has(String(marked.code))) {
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
      // The membership check goes first: a non-fs error never has its properties read, so a throwing `code` or
      // `path` getter cannot replace the original throw with the getter's error.
      if (!(typeof error === "object" && error !== null && fsErrors.has(error))) {
        return undefined;
      }
      // Only marked errors get here, and marking parsed the same shape, so this parse cannot fail either.
      const fs = z.safeParse(FsError, error).data;
      if (fs === undefined) {
        return undefined;
      }
      // The raw code value, as the marking errno test saw it.
      const code = fs.code as string;
      const at = fs.path ?? path;
      if (code === "ENOENT") {
        return { _tag: "SessionNotFound", path: at };
      }
      return { _tag: "ReadFailed", path: at, message: error instanceof Error ? error.message : code, cause: error };
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
