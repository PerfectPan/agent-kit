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

/** One group of `mergeByTimeStream`: its iterator, and the state that applies `inheritTimes` a record at a time. */
interface TimedStream {
  iterator: AsyncIterator<TimedRecord>;
  /** Records whose time is decided, waiting for the merge to pick them. */
  ready: StampedRecord[];
  /** The leading records before the group's first known time, which that time backfills. */
  leading: TimedRecord[];
  lastKnown: number | undefined;
  done: boolean;
  /** The record the merge has pulled from `ready` and not emitted yet. */
  head: StampedRecord | undefined;
}

async function pull(stream: TimedStream): Promise<void> {
  if (stream.head !== undefined || stream.done) {
    return;
  }
  for (;;) {
    const at = stream.ready.shift();
    if (at !== undefined) {
      stream.head = at;
      return;
    }
    if (stream.done) {
      return;
    }
    const step = await stream.iterator.next();
    if (step.done) {
      stream.done = true;
      // A group whose records name no time at all takes 1, like `inheritTimes` leaves them.
      for (const timed of stream.leading) {
        stream.ready.push({ record: timed.record, ts: 1 });
      }
      stream.leading = [];
      continue;
    }
    const { record, time } = step.value;
    if (time === undefined) {
      if (stream.lastKnown !== undefined) {
        stream.ready.push({ record, ts: stream.lastKnown });
      } else {
        stream.leading.push(step.value);
      }
      continue;
    }
    if (stream.lastKnown === undefined && stream.leading.length > 0) {
      // The first known time is also the leading gap's: every record before it takes it.
      for (const timed of stream.leading) {
        stream.ready.push({ record: timed.record, ts: time });
      }
      stream.leading = [];
    }
    stream.lastKnown = time;
    stream.ready.push({ record, ts: time });
  }
}

/**
 * Streams the merge `mergeByTime` gives, one record at a time: each step takes the head record with the smallest
 * time, a tie goes to the earlier group, and no group is reordered. Each group applies `inheritTimes` as its records
 * are pulled, so a caller that keeps no records buffers at most a group's leading records before its first known
 * time — the whole group only when none of its records names a time.
 */
export async function* mergeByTimeStream(
  groups: readonly AsyncIterable<TimedRecord>[]
): AsyncGenerator<StampedRecord, void, undefined> {
  const streams: TimedStream[] = groups.map((group) => ({
    iterator: group[Symbol.asyncIterator](),
    ready: [],
    leading: [],
    lastKnown: undefined,
    done: false,
    head: undefined
  }));
  for (const stream of streams) {
    await pull(stream);
  }
  for (;;) {
    let pick = -1;
    for (const [index, stream] of streams.entries()) {
      if (stream.head === undefined) {
        continue;
      }
      if (pick < 0 || stream.head.ts < streams[pick]!.head!.ts) {
        pick = index;
      }
    }
    if (pick < 0) {
      return;
    }
    const picked = streams[pick]!;
    if (picked.head === undefined) {
      return;
    }
    const { record, ts } = picked.head;
    yield { record, ts };
    picked.head = undefined;
    await pull(picked);
  }
}

/** Sets `seq` to each event's index; the last step of every translation. */
export function assignSeq(events: TranscriptEvent[]): void {
  for (let index = 0; index < events.length; index++) {
    events[index]!.seq = index;
  }
}
