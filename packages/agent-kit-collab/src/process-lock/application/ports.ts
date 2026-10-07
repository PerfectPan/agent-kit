import type { Platform } from "@rivus/agent-kit/platform";

/**
 * The part of Platform a process lock uses. With `sqlite` the lock is an exclusive SQLite lock; without it, a lock
 * file. `process` supplies the identity recorded for diagnostics and, for lock files, judged for liveness; it throws
 * on win32, which the lock does not support.
 */
export type ProcessLockPlatform = Pick<Platform, "fs" | "process" | "clock" | "sqlite">;
