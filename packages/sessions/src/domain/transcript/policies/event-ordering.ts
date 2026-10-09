import type { SourcedRecord } from "../value-objects/source-pointer.js";
import type { TranscriptEvent } from "../value-objects/transcript-event.js";

/** Epoch milliseconds from a record's time field: seconds or milliseconds, or an ISO string. Missing is `undefined`. */
export function timeOf(value: number | string | undefined): number | undefined {
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
 * Times in file order: a gap takes the previous known time, a leading gap the first known one, and a file with no
 * time at all gets 1, so no event has `ts` 0.
 */
export function inheritTimes(times: readonly (number | undefined)[]): number[] {
  const inherited = times.slice();
  let last: number | undefined;
  for (let index = 0; index < inherited.length; index++) {
    if (inherited[index] === undefined) {
      inherited[index] = last;
    } else {
      last = inherited[index];
    }
  }
  const known = inherited.find((value) => value !== undefined);
  if (known !== undefined) {
    for (let index = 0; index < inherited.length && inherited[index] === undefined; index++) {
      inherited[index] = known;
    }
  }
  return inherited.map((value) => value ?? known ?? 1);
}

/** A record with the time its log wrote for it: `time` is `undefined` when it carries none and inherits one. */
export interface TimedRecord {
  record: SourcedRecord;
  time: number | undefined;
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
export function mergeByTime(groups: readonly (readonly TimedRecord[])[]): StampedRecord[] {
  const times = groups.map((group) => inheritTimes(group.map(({ time }) => time)));
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
    out.push({ record: groups[pick]![at]!.record, ts: times[pick]![at]! });
    cursor[pick] = at + 1;
  }
}

/** Sets `seq` to each event's index; the last step of every translation. */
export function assignSeq(events: TranscriptEvent[]): void {
  for (let index = 0; index < events.length; index++) {
    events[index]!.seq = index;
  }
}
