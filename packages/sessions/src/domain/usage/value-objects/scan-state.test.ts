import { describe, expect, it } from "vitest";

import { keylessRecordRead, nextMark, type UsageScanMark } from "./scan-state.js";

describe("keyless mark", () => {
  const mark: UsageScanMark = { time: 100, count: 2 };

  it("leaves out the records up to the latest time read, by count at that time", () => {
    expect(keylessRecordRead(mark, 90, 0)).toBe(true);
    expect(keylessRecordRead(mark, 100, 0)).toBe(true);
    expect(keylessRecordRead(mark, 100, 1)).toBe(true);
    expect(keylessRecordRead(mark, 100, 2)).toBe(false);
    expect(keylessRecordRead(mark, 101, 0)).toBe(false);
  });

  it("moves to the latest time, and counts the records read at it", () => {
    expect(nextMark(undefined, 5)).toEqual({ time: 5, count: 1 });
    expect(nextMark(mark, 50)).toEqual(mark);
    expect(nextMark(mark, 100)).toEqual({ time: 100, count: 3 });
    expect(nextMark(mark, 200)).toEqual({ time: 200, count: 1 });
  });
});
