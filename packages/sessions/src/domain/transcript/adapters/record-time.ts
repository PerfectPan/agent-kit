import type { SourcedRecord } from "../index.js";
import { type TimedRecord } from "../index.js";
import { timeOfValue } from "./timestamp.js";

/** A record's own time in epoch milliseconds, `undefined` when the log carries none this kit can read. */
export function recordTime(record: SourcedRecord): number | undefined {
  return timeOfValue(record.value);
}

/** The record with its own time, as `mergeByTime` takes it. */
export function timedRecord(record: SourcedRecord): TimedRecord {
  return { record, time: recordTime(record) };
}
