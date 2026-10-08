export type Env = Readonly<Record<string, string | undefined>>;

export type OperatingSystem = "darwin" | "linux" | "win32";

/** `other` covers sockets, FIFOs and devices. */
export type FileKind = "file" | "dir" | "symlink" | "other";

export interface FileStat {
  readonly kind: FileKind;
  readonly size: number;
  readonly mtimeMs: number;
}

export interface DirEntry {
  readonly name: string;
  readonly kind: FileKind;
}

/** Byte range of a file read; `end` is exclusive, like `Blob.slice`. */
export interface ByteRange {
  readonly start: number;
  readonly end?: number;
}

export interface PlatformFs {
  /** Does not follow a symlink at `path` unless `followSymlinks` is set (lstat semantics). */
  stat(path: string, options?: { readonly followSymlinks?: boolean }): Promise<FileStat | undefined>;
  /** Resolves to `undefined` when the target does not exist; path checks then resolve the nearest existing parent. */
  realpath(path: string): Promise<string | undefined>;
  /**
   * Lists entries without following symlinks. Rejects when `dir` does not exist or is not a directory; callers that
   * may see a missing directory call `stat` first.
   */
  list(dir: string): Promise<DirEntry[]>;
  /** Raw chunks; split them with `splitLines`, which tracks byte offsets. */
  read(path: string, range?: ByteRange): AsyncIterable<Uint8Array>;
  /**
   * Writes a temp file next to `path` and renames it over `path`. Without `mode`, an existing file keeps its mode.
   * A symlink at `path` is replaced by a regular file, not written through, so callers `realpath` first.
   */
  writeAtomic(path: string, data: Uint8Array | string, options?: { readonly mode?: number }): Promise<void>;
  /** Creates an empty file only if `path` does not exist; resolves to `false` when it already exists. */
  createExclusive(path: string): Promise<boolean>;
  /**
   * Creates a directory and its missing parents, like `mkdir -p`; resolves when it already exists. Rejects when
   * `path` or one of its parents is a file.
   */
  mkdir(path: string): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  /**
   * Removes a file, a symlink (not its target) or an empty directory. Resolves when nothing is at `path`; rejects for a
   * non-empty directory.
   */
  remove(path: string): Promise<void>;
}

export interface ExitStatus {
  readonly code: number | null;
  readonly signal: string | null;
}

export interface RunOptions {
  readonly cwd?: string;
  /** The complete child environment; defaults to `Platform.env`, never the live process environment. */
  readonly env?: Env;
  /** When it elapses, the child gets SIGTERM, then SIGKILL after a grace period, and the result has `timedOut`. */
  readonly timeoutMs: number;
  /** Aborting stops the child the same way and rejects with `signal.reason`. */
  readonly signal?: AbortSignal;
}

export interface RunResult extends ExitStatus {
  readonly stdout: string;
  readonly stderr: string;
  readonly timedOut: boolean;
}

export interface SpawnOptions {
  readonly cwd: string;
  /** The complete child environment; the parent environment is not inherited. */
  readonly env: Env;
  /** Aborting sends SIGTERM, then SIGKILL after a grace period. */
  readonly signal?: AbortSignal;
}

export interface ChildHandle {
  readonly stdin: WritableStream<Uint8Array>;
  readonly stdout: ReadableStream<Uint8Array>;
  readonly stderr: ReadableStream<Uint8Array>;
  readonly exited: Promise<ExitStatus>;
  kill(signal?: "SIGTERM" | "SIGKILL"): void;
}

/** Not supported on win32, where `self` and `identify` throw. */
export interface ProcessIdentity {
  readonly host: string;
  readonly bootId: string;
  readonly pid: number;
  /** Compared for equality only: a reused pid has a different start time within the same boot. */
  readonly startTime: number;
}

export interface PlatformProcess {
  /**
   * Runs a short command without a shell and with stdin closed. A non-zero exit or a terminating signal resolves;
   * failing to start rejects with the spawn error (an errno `code`); writing more than 4 MiB to stdout or stderr rejects
   * with code `ERR_CHILD_PROCESS_STDIO_MAXBUFFER`. Output stops being collected shortly
   * after the command exits, even if a grandchild keeps stdout open.
   */
  run(command: string, args: readonly string[], options: RunOptions): Promise<RunResult>;
  spawn(command: string, args: readonly string[], options: SpawnOptions): ChildHandle;
  readonly self: ProcessIdentity;
  identify(pid: number): ProcessIdentity | undefined;
}

export interface PlatformClock {
  now(): number;
  /** Lease expiry is judged with the observer's monotonic clock, never with wall-clock time from another process. */
  monotonic(): number;
}

export type SqliteValue = null | number | bigint | string | Uint8Array;

export interface SqliteRunResult {
  readonly changes: number | bigint;
  readonly lastInsertRowid: number | bigint;
}

export interface SqliteStatement {
  run(...params: SqliteValue[]): SqliteRunResult;
  get(...params: SqliteValue[]): Record<string, SqliteValue> | undefined;
  all(...params: SqliteValue[]): Record<string, SqliteValue>[];
}

export interface SqliteDatabase {
  exec(sql: string): void;
  prepare(sql: string): SqliteStatement;
  close(): void;
}

export interface PlatformSqlite {
  open(path: string, options?: { readonly readonly?: boolean }): SqliteDatabase;
}

/**
 * Host capabilities injected into use cases. A use case declares only the part it needs, for example
 * `Pick<Platform, "fs" | "env" | "home">`.
 */
export interface Platform {
  readonly env: Env;
  readonly home: string;
  readonly os: OperatingSystem;
  readonly fs: PlatformFs;
  readonly process: PlatformProcess;
  readonly clock: PlatformClock;
  readonly sqlite?: PlatformSqlite;
}
