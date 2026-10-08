import { randomBytes } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, mkdir, open, readdir, realpath, rename, rmdir, stat, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";

import type { ByteRange, FileKind, PlatformFs } from "@rivus/agent-kit-platform";

import { hasCode } from "./error-code.js";

/** One chunk covers a 64 KiB head or tail read. */
const READ_CHUNK_BYTES = 64 * 1024;

interface TypedEntry {
  isFile(): boolean;
  isDirectory(): boolean;
  isSymbolicLink(): boolean;
}

export const nodeFs: PlatformFs = {
  async stat(path, options) {
    const stats = await absentAsUndefined(options?.followSymlinks === true ? stat(path) : lstat(path));
    if (stats === undefined) {
      return undefined;
    }
    return { kind: kindOf(stats), size: stats.size, mtimeMs: stats.mtimeMs };
  },
  realpath(path) {
    return absentAsUndefined(realpath(path));
  },
  async list(dir) {
    const entries = await readdir(dir, { withFileTypes: true });
    return entries.map((entry) => ({ name: entry.name, kind: kindOf(entry) }));
  },
  read: readRange,
  writeAtomic,
  async createExclusive(path) {
    try {
      const handle = await open(path, "wx");
      await handle.close();
      return true;
    } catch (error) {
      if (hasCode(error, "EEXIST")) {
        return false;
      }
      throw error;
    }
  },
  async mkdir(path) {
    await mkdir(path, { recursive: true });
  },
  rename,
  async remove(path) {
    const stats = await absentAsUndefined(lstat(path));
    if (stats === undefined) {
      return;
    }
    await absentAsUndefined(stats.isDirectory() ? rmdir(path) : unlink(path));
  }
};

function kindOf(entry: TypedEntry): FileKind {
  if (entry.isSymbolicLink()) {
    return "symlink";
  }
  if (entry.isDirectory()) {
    return "dir";
  }
  return entry.isFile() ? "file" : "other";
}

async function* readRange(path: string, range?: ByteRange): AsyncGenerator<Uint8Array, void, undefined> {
  const start = range?.start ?? 0;
  const end = range?.end;
  if (end !== undefined && end <= start) {
    return;
  }
  // Node's `end` is inclusive.
  yield* createReadStream(path, {
    start,
    ...(end === undefined ? {} : { end: end - 1 }),
    highWaterMark: READ_CHUNK_BYTES
  });
}

async function writeAtomic(path: string, data: Uint8Array | string, options?: { readonly mode?: number }) {
  const mode = options?.mode ?? (await absentAsUndefined(stat(path)))?.mode;
  // Fixed length, so a target name near the file system's limit still leaves room for its temp sibling.
  const temp = join(dirname(path), `.${randomBytes(8).toString("hex")}.tmp`);
  const handle = await open(temp, "wx");
  try {
    try {
      if (mode !== undefined) {
        // An explicit chmod, unlike the open() mode, is not narrowed by the umask.
        await handle.chmod(mode & 0o7777);
      }
      await handle.writeFile(data);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temp, path);
  } catch (error) {
    await unlink(temp).catch(() => undefined);
    throw error;
  }
}

async function absentAsUndefined<T>(pending: Promise<T>): Promise<T | undefined> {
  try {
    return await pending;
  } catch (error) {
    if (hasCode(error, "ENOENT", "ENOTDIR")) {
      return undefined;
    }
    throw error;
  }
}
