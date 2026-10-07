export type Env = Readonly<Record<string, string | undefined>>;

export type OperatingSystem = "darwin" | "linux" | "win32";

export type FileKind = "file" | "dir" | "symlink";

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
  list(dir: string): Promise<DirEntry[]>;
  /** Raw chunks; split them with `splitLines`, which tracks byte offsets. */
  read(path: string, range?: ByteRange): AsyncIterable<Uint8Array>;
  writeAtomic(path: string, data: Uint8Array | string, options?: { readonly mode?: number }): Promise<void>;
  /** Creates an empty file only if `path` does not exist; resolves to `false` when it already exists. */
  createExclusive(path: string): Promise<boolean>;
  rename(from: string, to: string): Promise<void>;
  remove(path: string): Promise<void>;
}

export interface ExitStatus {
  readonly code: number | null;
  readonly signal: string | null;
}

export interface RunOptions {
  readonly cwd?: string;
  readonly env?: Env;
  readonly timeoutMs: number;
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

export interface ProcessIdentity {
  readonly host: string;
  readonly bootId: string;
  readonly pid: number;
  /** Compared for equality only: a reused pid has a different start time within the same boot. */
  readonly startTime: number;
}

export interface PlatformProcess {
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
