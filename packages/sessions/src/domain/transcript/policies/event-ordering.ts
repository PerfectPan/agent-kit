import type { SourcedRecord } from "../value-objects/source-pointer.js";
import type { TranscriptEvent } from "../value-objects/transcript-event.js";

/** Epoch milliseconds from a record's time field: seconds or milliseconds, or an ISO string. Missing is `undefined`. */
export function timeOf(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value < 1e12 ? value * 1000 : value;
  }
  if (typeof value === "string" && value) {
    const ms = Date.parse(value);
    if (!Number.isNaN(ms)) {
      return ms;
    }
  }
  return undefined;
}

/**
 * Times of `records` in file order from their `timestamp` field: a gap takes the previous known time, a leading gap
 * the first known one, and a file with no time at all gets 1, so no event has `ts` 0.
 */
export function inheritTimes(records: readonly SourcedRecord[]): number[] {
  const times = records.map((record) => recordTime(record));
  let last: number | undefined;
  for (let index = 0; index < times.length; index++) {
    if (times[index] === undefined) {
      times[index] = last;
    } else {
      last = times[index];
    }
  }
  const known = times.find((value) => value !== undefined);
  if (known !== undefined) {
    for (let index = 0; index < times.length && times[index] === undefined; index++) {
      times[index] = known;
    }
  }
  return times.map((value) => value ?? known ?? 1);
}

function recordTime(record: SourcedRecord): number | undefined {
  const value = record.value;
  return typeof value === "object" && value !== null ? timeOf((value as Record<string, unknown>).timestamp) : undefined;
}

export interface StampedRecord {
  record: SourcedRecord;
  ts: number;
}

/**
 * Merges files (the main file first, then the others) without reordering any of them. Each step takes the head
 * record with the smallest time, and a tie goes to the earlier file. Times inside one file may go backwards (Claude
 * Code writes a compact summary with an earlier time than the boundary it follows); file order wins over them.
 */
export function mergeByTime(groups: readonly (readonly SourcedRecord[])[]): StampedRecord[] {
  const times = groups.map((group) => inheritTimes(group));
  const cursor = groups.map(() => 0);
  const out: StampedRecord[] = [];
  for (;;) {
    let pick = -1;
    for (let index = 0; index < groups.length; index++) {
      if (cursor[index]! >= groups[index]!.length) {
        continue;
      }
      if (pick < 0 || times[index]![cursor[index]!]! < times[pick]![cursor[pick]!]!) {
        pick = index;
      }
    }
    if (pick < 0) {
      return out;
    }
    const at = cursor[pick]!;
    out.push({ record: groups[pick]![at]!, ts: times[pick]![at]! });
    cursor[pick] = at + 1;
  }
}

/** Sets `seq` to each event's index; the last step of every translation. */
export function assignSeq(events: TranscriptEvent[]): void {
  for (let index = 0; index < events.length; index++) {
    events[index]!.seq = index;
  }
}
