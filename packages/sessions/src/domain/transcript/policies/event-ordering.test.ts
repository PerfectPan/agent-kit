import { describe, expect, it } from "vite-plus/test";

import { baseEvent } from "../factories/transcript-event.js";
import { timedRecord } from "../adapters/record-time.js";
import type { SourcedRecord } from "../value-objects/source-pointer.js";
import { inheritTimes, mergeByTime } from "./event-ordering.js";
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
