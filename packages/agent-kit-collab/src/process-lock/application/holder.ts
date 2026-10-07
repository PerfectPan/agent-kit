import * as z from "zod/mini";

import type { ProcessLockPlatform } from "./ports.js";

/** Who holds or held a process lock, as recorded when it was acquired; it may be stale. */
export interface ProcessLockHolder {
  readonly host: string;
  readonly bootId: string;
  readonly pid: number;
  readonly startTime: number;
  /** Wall-clock milliseconds. */
  readonly acquiredAt: number;
}

/** A holder record plus the nonce that tells two acquisitions by one process apart. */
export interface HolderStamp extends ProcessLockHolder {
  readonly nonce: string;
}

const stampSchema = z.object({
  host: z.string(),
  bootId: z.string(),
  pid: z.number(),
  startTime: z.number(),
  acquiredAt: z.number(),
  nonce: z.string()
});

export function newStamp(platform: ProcessLockPlatform): HolderStamp {
  const { host, bootId, pid, startTime } = platform.process.self;
  return { host, bootId, pid, startTime, acquiredAt: platform.clock.now(), nonce: crypto.randomUUID() };
}

export function holderOf(stamp: HolderStamp): ProcessLockHolder {
  const { host, bootId, pid, startTime, acquiredAt } = stamp;
  return { host, bootId, pid, startTime, acquiredAt };
}

/** What a holder file says: `undefined` when it is missing, `text` alone when it is empty or unreadable. */
export interface StampFile {
  readonly text: string;
  readonly stamp: HolderStamp | undefined;
}

export async function readStamp(platform: ProcessLockPlatform, path: string): Promise<StampFile | undefined> {
  const text = await readText(platform, path);
  if (text === undefined) {
    return undefined;
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { text, stamp: undefined };
  }
  const parsed = stampSchema.safeParse(json);
  return { text, stamp: parsed.success ? parsed.data : undefined };
}

/** The text of a small file, `undefined` when it does not exist. */
export async function readText(platform: Pick<ProcessLockPlatform, "fs">, path: string): Promise<string | undefined> {
  const decoder = new TextDecoder();
  let text = "";
  try {
    for await (const chunk of platform.fs.read(path)) {
      text += decoder.decode(chunk, { stream: true });
    }
  } catch (error) {
    if (typeof error === "object" && error !== null && (error as { code?: unknown }).code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
  return text + decoder.decode();
}
