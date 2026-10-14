import type { Platform } from "@rivus/agent-kit/platform";

/**
 * The part of Platform a process lock uses. With `sqlite` the lock is an exclusive SQLite lock; without it, a lock
 * file. `process` supplies this process's identity, which a SQLite lock records for diagnostics and a lock file is
 * judged by.
 */
export type ProcessLockPlatform = Pick<Platform, "fs" | "process" | "clock" | "sqlite">;
