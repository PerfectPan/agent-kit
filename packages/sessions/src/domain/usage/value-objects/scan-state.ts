import type { CodingAgentId } from "@rivus/agent-kit-catalog";

import type { UsageCursor } from "./usage-cursor.js";

/** The records of a source that have no request key: the time of the latest one read, and how many had that time. */
export interface UsageScanMark {
  readonly time: number;
  readonly count: number;
}

/** What a scan knows about one source. */
export interface UsageScanSource {
  readonly agent: CodingAgentId;
  /** Where the source was read last. */
  readonly path: string;
  /** Its modification time when it was listed last: once that is before `since`, no listing finds it any more. */
  readonly mtimeMs: number;
  /** Where its decode stopped; absent when it could not be read again after it was rewritten. */
  readonly cursor?: UsageCursor;
  /** Set when the source has records without a request key, for reading it again after a rewrite. */
  readonly mark?: UsageScanMark;
}

/** What a scan carries to the next one, as plain JSON data. */
export interface UsageScanState {
  /**
   * By agent and `UsageSource.id`, so a source that its agent moved keeps its cursor; by agent, id and path while one
   * scan finds the id at several paths (a copy), so each copy keeps a cursor of its own.
   */
  readonly sources: Readonly<Record<string, UsageScanSource>>;
  /**
   * The requests counted from `since` on, by agent and by the day (UTC, days since the epoch) of their record: each a
   * 54-bit hash of the request's key in 9 base64url characters, the hashes of one day joined.
   */
  readonly requests: Readonly<Record<string, Readonly<Record<string, string>>>>;
}

/** The mark after a keyless record at `time`: the latest time read, or one more record at it. */
export function nextMark(mark: UsageScanMark | undefined, time: number): UsageScanMark {
  if (mark === undefined || time > mark.time) {
    return { time, count: 1 };
  }
  return time === mark.time ? { time, count: mark.count + 1 } : mark;
}

/**
 * Whether a keyless record at `time` lies in the part of the source already read, so a scan that reads a rewritten
 * source again leaves it out: before the mark's time, or at it while fewer than `mark.count` records of that time have
 * been passed. `skipped` counts the records of that time already passed.
 */
export function keylessRecordRead(mark: UsageScanMark, time: number, skipped: number): boolean {
  return time < mark.time || (time === mark.time && skipped < mark.count);
}
