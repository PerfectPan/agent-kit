import type { SourcedRecord } from "../value-objects/source-pointer.js";
import { type TimedRecord } from "../services/event-ordering.js";
import { timeOfValue } from "../../../lib/timestamp.js";

/** A record's own time in epoch milliseconds, `undefined` when the log carries none this kit can read. */
export function recordTime(record: SourcedRecord): number | undefined {
  return timeOfValue(record.value);
}

/** The record with its own time, as `mergeByTime` takes it. */
export function timedRecord(record: SourcedRecord): TimedRecord {
  return { record, time: recordTime(record) };
}
