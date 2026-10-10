import { describe, expect, it } from "vite-plus/test";

import { baseEvent } from "../factories/transcript-event.js";
import { timedRecord } from "../adapters/record-time.js";
import type { SourcedRecord } from "../value-objects/source-pointer.js";
import { inheritTimes, mergeByTime, mergeByTimeStream, type TimedRecord } from "./event-ordering.js";
import { placeRequest } from "./request-placement.js";

function records(file: string, times: (string | undefined)[]): SourcedRecord[] {
  return times.map((timestamp, index) => ({
    file,
    offset: index * 10,
    length: 9,
    line: index + 1,
    value: timestamp === undefined ? {} : { timestamp }
  }));
}

const at = (seconds: number) => `2026-01-01T00:00:${String(seconds).padStart(2, "0")}.000Z`;
const ms = (value: string | undefined) => (value === undefined ? undefined : Date.parse(value));

describe("inheritTimes", () => {
  it("fills a gap from the previous time, a leading gap from the first time, and never returns 0", () => {
    expect(inheritTimes([undefined, ms(at(2)), undefined, ms(at(1))])).toEqual(
      [at(2), at(2), at(2), at(1)].map((value) => Date.parse(value))
    );
    expect(inheritTimes([undefined, undefined])).toEqual([1, 1]);
  });
});

describe("mergeByTime", () => {
  it("interleaves files by time, gives a tie to the earlier file, and never reorders a file", () => {
    const main = records("main", [at(0), at(3), at(1), at(5)]).map(timedRecord);
    const sub = records("sub", [at(2), at(3)]).map(timedRecord);
    const merged = mergeByTime([main, sub]).map(({ record }) => `${record.file}:${record.line}`);
    expect(merged).toEqual(["main:1", "sub:1", "main:2", "main:3", "sub:2", "main:4"]);
  });
});

describe("mergeByTimeStream", () => {
  const patterns: readonly (number | undefined)[][] = [
    [undefined, undefined, undefined, undefined],
    [undefined, 0, undefined, 5, undefined],
    [0, undefined, 1],
    [3, 2, 1],
    [undefined],
    [1]
  ];

  async function collect(groups: readonly AsyncIterable<TimedRecord>[]): Promise<string[]> {
    const out: string[] = [];
    for await (const stamped of mergeByTimeStream(groups)) {
      out.push(`${stamped.record.file}:${stamped.record.line}`);
    }
    return out;
  }
  const streamed = (times: readonly (number | undefined)[], index: number): AsyncGenerator<TimedRecord> =>
    (async function* () {
      yield* records(
        `g${index}`,
        times.map((second) => (second === undefined ? undefined : at(second)))
      ).map(timedRecord);
    })();

  it("gives mergeByTime's merge on generated groups with missing times", async () => {
    for (const a of patterns) {
      for (const b of patterns) {
        for (const c of patterns) {
          const groups = [a, b, c].map((times, index) =>
            records(
              `g${index}`,
              times.map((second) => (second === undefined ? undefined : at(second)))
            ).map(timedRecord)
          );
          const expected = mergeByTime(groups).map(({ record }) => `${record.file}:${record.line}`);
          expect(
            await collect([a, b, c].map((times, index) => streamed(times, index))),
            `${JSON.stringify([a, b, c])}`
          ).toEqual(expected);
        }
      }
    }
  });

  it("returns the iterators it has not read to the end when the consumer stops early", async () => {
    const closed: string[] = [];
    const group = async function* (
      name: string,
      times: (string | undefined)[]
    ): AsyncGenerator<ReturnType<typeof timedRecord>> {
      try {
        for (const record of records(name, times)) {
          yield timedRecord(record);
        }
      } finally {
        closed.push(name);
      }
    };
    let taken = 0;
    for await (const stamped of mergeByTimeStream([group("main", [at(0), at(2)]), group("sub", [at(1), at(3)])])) {
      if ((taken += 1) === 2) {
        break;
      }
      void stamped;
    }
    expect(closed).toStrictEqual(["main", "sub"]);
  });

  it("returns the other iterators when a group throws on its first pull", async () => {
    const closed: string[] = [];
    const healthy = async function* (): AsyncGenerator<TimedRecord> {
      try {
        for (const record of records("healthy", [at(0), at(1)])) {
          yield timedRecord(record);
        }
      } finally {
        closed.push("healthy");
      }
    };
    // An iterator whose first pull rejects — a generator that never yields would not read as one.
    const failing = (): AsyncIterableIterator<TimedRecord> => ({
      next: () => Promise.reject(new Error("read failed")),
      [Symbol.asyncIterator]() {
        return this;
      }
    });
    await expect(collect([healthy(), failing()])).rejects.toThrow("read failed");
    expect(closed).toStrictEqual(["healthy"]);
  });

  it("returns the other iterators when one group's read throws", async () => {
    const closed: string[] = [];
    const healthy = async function* (): AsyncGenerator<ReturnType<typeof timedRecord>> {
      try {
        for (const record of records("healthy", [at(0), at(1)])) {
          yield timedRecord(record);
        }
      } finally {
        closed.push("healthy");
      }
    };
    const failing = async function* (): AsyncGenerator<ReturnType<typeof timedRecord>> {
      yield timedRecord(records("failing", [at(0)])[0]!);
      throw new Error("read failed");
    };
    await expect(collect([healthy(), failing()])).rejects.toThrow("read failed");
    expect(closed).toStrictEqual(["healthy"]);
  });
});

describe("placeRequest", () => {
  it("puts a request logged after its output before that output and gives it the output's time", () => {
    const [user, reasoning, assistant, usage] = records("r", [at(0), at(1), at(2), at(3)]);
    const events = [
      baseEvent(user!, "user", {}, { ts: 1 }),
      baseEvent(reasoning!, "reasoning", {}, { ts: 2 }),
      baseEvent(assistant!, "assistant", {}, { ts: 3 })
    ];
    const request = baseEvent(usage!, "request", {}, { id: "request:1", ts: 4, requestId: "q1" });
    expect(placeRequest(events, 0, request)).toBe(4);
    expect(events.map((event) => event.kind)).toEqual(["user", "request", "reasoning", "assistant"]);
    expect(request.ts).toBe(2);
    expect(events.map((event) => event.requestId)).toEqual(["q1", "q1", "q1", "q1"]);
  });

  it("appends a request with no output after `from`", () => {
    const [user, usage] = records("r", [at(0), at(1)]);
    const events = [baseEvent(user!, "user", {}, { ts: 1 })];
    placeRequest(events, 1, baseEvent(usage!, "request", {}, { ts: 5 }));
    expect(events.map((event) => [event.kind, event.ts])).toEqual([
      ["user", 1],
      ["request", 5]
    ]);
  });
});
