import * as z from "zod/mini";

import type { SourcedRecord } from "../index.js";
import { timeOf, type TimedRecord } from "../index.js";
import { lenient } from "./lenient.js";

/**
 * A record's own time as agent logs write it: epoch seconds or milliseconds as a number, or a timestamp string. Read
 * leniently like every agent log, and shared by every adapter's record schema; `timeOf` turns it into epoch ms.
 */
export const logTimestamp: z.ZodMiniCatch<z.ZodMiniOptional<z.ZodMiniUnion<[z.ZodMiniNumber, z.ZodMiniString]>>> =
  lenient(z.union([z.number(), z.string()]));
/** The fields of a record whose time alone a reader needs: the `timestamp` the log wrote. */
const timestampedRecord = z.looseObject({ timestamp: logTimestamp });

/** The time a raw record value carries in its `timestamp` field, in epoch milliseconds. */
export function timeOfValue(value: unknown): number | undefined {
  return timeOf(z.safeParse(timestampedRecord, value).data?.timestamp);
}

/** A record's own time in epoch milliseconds, `undefined` when the log carries none this kit can read. */
export function recordTime(record: SourcedRecord): number | undefined {
  return timeOfValue(record.value);
}

/** The record with its own time, as `mergeByTime` takes it. */
export function timedRecord(record: SourcedRecord): TimedRecord {
  return { record, time: recordTime(record) };
}
