import type {
  ByteRange,
  DirEntry,
  Env,
  FileStat,
  OperatingSystem,
  Platform,
  PlatformFs
} from "@rivus/agent-kit-platform";

/** A seeded file: its content, or its content and modification time. */
export type MemoryFile = string | Uint8Array | { readonly content: string | Uint8Array; readonly mtimeMs?: number };

export interface MemoryPlatformOptions {
  /** Files by absolute `/`-separated path; their parent directories exist implicitly. */
  readonly files?: Readonly<Record<string, MemoryFile>>;
  readonly env?: Env;
  readonly home?: string;
  readonly os?: OperatingSystem;
  /** The wall clock; defaults to `Date.now`. New files take their modification time from it. */
  readonly now?: () => number;
  /** Largest chunk `fs.read` yields, so tests can cross chunk boundaries; defaults to 64 KB. */
  readonly chunkSize?: number;
}

/**
 * The part of Platform that `createMemoryPlatform` implements. It has no processes and no SQLite, so it runs in a
 * browser as well as in Node.
 */
export type MemoryPlatform = Pick<Platform, "env" | "home" | "os" | "fs" | "clock">;

interface StoredFile {
  bytes: Uint8Array;
  mtimeMs: number;
}

/**
 * An in-memory Platform for tests. Paths are normalized (`//`, `.`, `..` and a trailing `/`); there are no special
 * files or symlinks, so `followSymlinks` changes nothing. `list` rejects for a missing path or a file; writing a file
 * creates its parent directories; removing a missing path resolves; `rename` follows POSIX (it replaces a file or an
 * empty directory, and needs the target's parent). Stored bytes are copied on the way in and out. Errors carry
 * Node's `code` (`ENOENT`, `EISDIR`, `ENOTDIR`, `ENOTEMPTY`, `EINVAL`), as the Node platform's do.
 */
export function createMemoryPlatform(options: MemoryPlatformOptions = {}): MemoryPlatform {
  const now = options.now ?? Date.now;
  const chunkSize = options.chunkSize ?? 64 * 1024;
  const files = new Map<string, StoredFile>();
  const dirs = new Map<string, number>([["/", now()]]);

  const addParents = (path: string): void => {
    for (let dir = parentOf(path); !dirs.has(dir); dir = parentOf(dir)) {
      if (files.has(dir)) {
        throw fsError("ENOTDIR", dir);
      }
      dirs.set(dir, now());
    }
  };
  const putFile = (path: string, bytes: Uint8Array, mtimeMs: number): void => {
    if (dirs.has(path)) {
      throw fsError("EISDIR", path);
    }
    addParents(path);
    files.set(path, { bytes, mtimeMs });
  };
  const hasChildren = (dir: string): boolean =>
    [...dirs.keys(), ...files.keys()].some((other) => other !== dir && parentOf(other) === dir);
  const fileAt = (path: string): StoredFile => {
    const file = files.get(path);
    if (file) {
      return file;
    }
    throw fsError(dirs.has(path) ? "EISDIR" : "ENOENT", path);
  };

  for (const [path, file] of Object.entries(options.files ?? {})) {
    const content = typeof file === "string" || file instanceof Uint8Array ? file : file.content;
    const mtimeMs = typeof file === "string" || file instanceof Uint8Array ? now() : (file.mtimeMs ?? now());
    putFile(normalize(path), toBytes(content), mtimeMs);
  }

  const fs: PlatformFs = {
    async stat(path): Promise<FileStat | undefined> {
      const key = normalize(path);
      const file = files.get(key);
      if (file) {
        return { kind: "file", size: file.bytes.byteLength, mtimeMs: file.mtimeMs };
      }
      const mtimeMs = dirs.get(key);
      return mtimeMs === undefined ? undefined : { kind: "dir", size: 0, mtimeMs };
    },
    async realpath(path) {
      const key = normalize(path);
      return files.has(key) || dirs.has(key) ? key : undefined;
    },
    async list(dir): Promise<DirEntry[]> {
      const key = normalize(dir);
      if (!dirs.has(key)) {
        throw fsError(files.has(key) ? "ENOTDIR" : "ENOENT", key);
      }
      const entries: DirEntry[] = [];
      for (const [paths, kind] of [
        [dirs.keys(), "dir"],
        [files.keys(), "file"]
      ] as const) {
        for (const path of paths) {
          if (path !== key && parentOf(path) === key) {
            entries.push({ name: path.slice(path.lastIndexOf("/") + 1), kind });
          }
        }
      }
      return entries.toSorted((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    },
    async *read(path, range?: ByteRange) {
      const bytes = fileAt(normalize(path)).bytes;
      const end = Math.min(range?.end ?? bytes.byteLength, bytes.byteLength);
      for (let at = range?.start ?? 0; at < end; at += chunkSize) {
        yield bytes.slice(at, Math.min(at + chunkSize, end));
      }
    },
    async writeAtomic(path, data) {
      putFile(normalize(path), toBytes(data), now());
    },
    async createExclusive(path) {
      const key = normalize(path);
      if (files.has(key) || dirs.has(key)) {
        return false;
      }
      putFile(key, new Uint8Array(0), now());
      return true;
    },
    async rename(from, to) {
      const source = normalize(from);
      const target = normalize(to);
      const file = files.get(source);
      if (!file && !dirs.has(source)) {
        throw fsError("ENOENT", source);
      }
      if (!dirs.has(parentOf(target))) {
        throw fsError(files.has(parentOf(target)) ? "ENOTDIR" : "ENOENT", target);
      }
      if (source === target) {
        return;
      }
      if (file) {
        if (dirs.has(target)) {
          throw fsError("EISDIR", target);
        }
        files.set(target, file);
        files.delete(source);
        return;
      }
      if (target.startsWith(`${source}/`)) {
        throw fsError("EINVAL", target);
      }
      if (files.has(target)) {
        throw fsError("ENOTDIR", target);
      }
      if (hasChildren(target)) {
        throw fsError("ENOTEMPTY", target);
      }
      dirs.delete(target);
      for (const map of [dirs, files] as Map<string, unknown>[]) {
        for (const [path, value] of Array.from(map)) {
          if (path === source || path.startsWith(`${source}/`)) {
            map.delete(path);
            map.set(target + path.slice(source.length), value);
          }
        }
      }
    },
    async remove(path) {
      const key = normalize(path);
      if (files.delete(key)) {
        return;
      }
      if (!dirs.has(key)) {
        return;
      }
      if (hasChildren(key)) {
        throw fsError("ENOTEMPTY", key);
      }
      dirs.delete(key);
    }
  };

  return {
    env: Object.freeze({ ...options.env }),
    home: options.home ?? "/u/me",
    os: options.os ?? "linux",
    fs,
    clock: { now, monotonic: () => performance.now() }
  };
}

function normalize(path: string): string {
  const parts: string[] = [];
  for (const part of path.split("/")) {
    if (part === "" || part === ".") {
      continue;
    }
    if (part === "..") {
      parts.pop();
    } else {
      parts.push(part);
    }
  }
  return `/${parts.join("/")}`;
}

function parentOf(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash <= 0 ? "/" : path.slice(0, slash);
}

// A copy that no caller holds: `Buffer#slice` would return a view of the caller's memory.
function toBytes(data: string | Uint8Array): Uint8Array {
  return typeof data === "string" ? new TextEncoder().encode(data) : new Uint8Array(data);
}

function fsError(code: string, path: string): Error {
  return Object.assign(new Error(`${code}: ${path}`), { code, path });
}
