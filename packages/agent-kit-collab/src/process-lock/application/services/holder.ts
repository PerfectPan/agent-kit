import * as z from "zod/mini";

import type { ProcessLockPlatform } from "../ports.js";

/**
 * Who holds or held a process lock, as recorded when it was acquired; it may be stale. A file lock always records
 * `bootId` and `startTime`, because it uses them to recognize a dead holder. A SQLite lock omits them: the kernel
 * releases that lock when the holder exits, and reading them would spawn a process.
 */
export interface ProcessLockHolder {
  readonly host: string;
  readonly pid: number;
  /** Wall-clock milliseconds. */
  readonly acquiredAt: number;
  readonly bootId?: string;
  readonly startTime?: number;
}

/** A file-lock record. Both identity fields are required, plus the nonce that tells two acquisitions apart. */
export interface HolderStamp extends ProcessLockHolder {
  readonly bootId: string;
  readonly startTime: number;
  readonly nonce: string;
}

/** A SQLite holder record. `bootId` and `startTime` are present only on a stamp written with a full identity. */
export interface SqliteStamp {
  readonly host: string;
  readonly pid: number;
  readonly acquiredAt: number;
  readonly nonce: string;
  readonly bootId?: string;
  readonly startTime?: number;
}

const stampSchema = z.object({
  host: z.string(),
  bootId: z.string(),
  pid: z.number(),
  startTime: z.number(),
  acquiredAt: z.number(),
  nonce: z.string()
});

const sqliteStampSchema = z.object({
  host: z.string(),
  pid: z.number(),
  acquiredAt: z.number(),
  nonce: z.string(),
  bootId: z.optional(z.string()),
  startTime: z.optional(z.number())
});

export function newStamp(platform: ProcessLockPlatform): HolderStamp {
  const { host, bootId, pid, startTime } = platform.process.self;
  return { host, bootId, pid, startTime, acquiredAt: platform.clock.now(), nonce: crypto.randomUUID() };
}

/** Host and pid only. Reading the rest of the identity would spawn a process, and SQLite does not need it. */
export function sqliteStamp(platform: ProcessLockPlatform): SqliteStamp {
  const { host, pid } = platform.process.self;
  return { host, pid, acquiredAt: platform.clock.now(), nonce: crypto.randomUUID() };
}

export function holderOf(stamp: HolderStamp): ProcessLockHolder {
  const { host, bootId, pid, startTime, acquiredAt } = stamp;
  return { host, bootId, pid, startTime, acquiredAt };
}

export function holderOfSqlite(stamp: SqliteStamp): ProcessLockHolder {
  const holder = { host: stamp.host, pid: stamp.pid, acquiredAt: stamp.acquiredAt };
  if (stamp.bootId === undefined && stamp.startTime === undefined) {
    return holder;
  }
  return {
    ...holder,
    ...(stamp.bootId === undefined ? {} : { bootId: stamp.bootId }),
    ...(stamp.startTime === undefined ? {} : { startTime: stamp.startTime })
  };
}

/** What a holder file says: `undefined` when it is missing, `text` alone when it is empty or unreadable. */
export interface StampFile {
  readonly text: string;
  readonly stamp: HolderStamp | undefined;
}

/** A Node error whose `code` says there is nothing at the path. */
const Missing = z.looseObject({ code: z.literal("ENOENT") });

/** The text of a small file, `undefined` when it does not exist. */
export async function readText(platform: Pick<ProcessLockPlatform, "fs">, path: string): Promise<string | undefined> {
  const decoder = new TextDecoder();
  let text = "";
  try {
    for await (const chunk of platform.fs.read(path)) {
      text += decoder.decode(chunk, { stream: true });
    }
  } catch (error) {
    if (Missing.safeParse(error).success) {
      return undefined;
    }
    throw error;
  }
  return text + decoder.decode();
}

function parseStamp<T>(
  schema: { safeParse(value: unknown): { success: true; data: T } | { success: false } },
  text: string
): T | undefined {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return undefined;
  }
  const parsed = schema.safeParse(json);
  return parsed.success ? parsed.data : undefined;
}

export async function readStamp(platform: ProcessLockPlatform, path: string): Promise<StampFile | undefined> {
  const text = await readText(platform, path);
  if (text === undefined) {
    return undefined;
  }
  return { text, stamp: parseStamp(stampSchema, text) };
}

/** What a SQLite holder file says. Accepts a full identity stamp and one that records only host, pid and time. */
export interface SqliteStampFile {
  readonly text: string;
  readonly stamp: SqliteStamp | undefined;
}

export async function readSqliteStamp(
  platform: ProcessLockPlatform,
  path: string
): Promise<SqliteStampFile | undefined> {
  const text = await readText(platform, path);
  if (text === undefined) {
    return undefined;
  }
  return { text, stamp: parseStamp(sqliteStampSchema, text) };
}
