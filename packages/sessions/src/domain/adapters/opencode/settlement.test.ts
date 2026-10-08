import { describe, expect, it } from "vitest";

import {
  LONGEST_MESSAGE_MS,
  RUNNING_IDS,
  createOpencodeSettlement,
  opencodeQueryFloor,
  type OpencodeTableRow
} from "./settlement.js";

/**
 * One `message` row: opencode names each message after its row, so the id is a number in a string, which the
 * watermark and the running/reported memories compare.
 */
const row = (id: string, updated: number, completed?: number, created = 1000): OpencodeTableRow => ({
  id,
  row: Number(id),
  updated,
  created,
  sessionId: "s",
  data: JSON.stringify({
    role: "assistant",
    id,
    sessionID: "s",
    ...(completed === undefined ? {} : { time: { completed } }),
    tokens: { input: 1, output: 1, total: 2 }
  })
});

describe("opencode settlement", () => {
  it("reports a finished message once, and a running one when the page that finishes it arrives", () => {
    const settlement = createOpencodeSettlement("opencode.db", { final: false });
    expect(settlement.position()).toEqual({ row: 0, updated: 0, id: "" });
    expect(settlement.push([row("1", 10, 10)])).toHaveLength(1);
    expect(settlement.push([row("1", 11, 11)])).toHaveLength(0);
    expect(settlement.push([row("2", 12)])).toHaveLength(0);
    expect(settlement.runningIds()).toEqual(["2"]);
    expect(settlement.push([row("2", 13, 13)])).toHaveLength(1);
    expect(settlement.push([row("3", 14)])).toHaveLength(0);
    expect(settlement.runningIds()).toEqual(["3"]);
  });

  it("follows the newest change through the first pass, then hands the position to the queries", () => {
    const settlement = createOpencodeSettlement("opencode.db", { final: false });
    settlement.push([row("1", 5, 1), row("2", 3, 1)]);
    expect(settlement.position()).toEqual({ row: 2, updated: 5, id: "1" });
    settlement.endByRow();
    expect(settlement.position().row).toBeUndefined();
    settlement.push([row("9", 7, 1)]);
    expect(settlement.position()).toEqual({ updated: 7, id: "9" });
  });

  it("reports a message that never finished at its creation time once the decode is final", () => {
    const settlement = createOpencodeSettlement("opencode.db", { final: true });
    const records = settlement.push([row("1", 10, undefined, 1234)]);
    expect(records).toHaveLength(1);
    expect(records[0]?.timestamp).toBe(1234);
    expect(settlement.runningIds()).toEqual([]);
  });

  it("reports a message still running from a previous decode at its creation time when final", () => {
    const previous = createOpencodeSettlement("opencode.db", { final: false });
    previous.push([row("1", 10)]);
    expect(previous.runningIds()).toEqual(["1"]);
    const settlement = createOpencodeSettlement("opencode.db", { state: previous.save(), final: true });
    const records = settlement.end([row("1", 10, undefined, 1234)]);
    expect(records).toHaveLength(1);
    expect(records[0]?.timestamp).toBe(1234);
    expect(settlement.runningIds()).toEqual([]);
  });

  it("leaves the position alone when it settles the final look at the running messages", () => {
    const previous = createOpencodeSettlement("opencode.db", { final: false });
    previous.push([row("1", 10)]);
    previous.endByRow();
    const settlement = createOpencodeSettlement("opencode.db", { state: previous.save(), final: true });
    settlement.push([row("9", 30, 1)]);
    const before = settlement.position();
    expect(before).toEqual({ updated: 30, id: "9" });
    // The row is re-fetched by id: its `time_updated` is older than the watermark and must not move it back.
    expect(settlement.end([row("1", 10, undefined, 1234)])).toHaveLength(1);
    expect(settlement.position()).toEqual(before);
  });

  it("forgets a running message whose row was deleted, and caps what the cursor remembers", () => {
    const settlement = createOpencodeSettlement("opencode.db", { final: false });
    for (let at = 0; at < RUNNING_IDS + 1; at++) {
      settlement.push([row(String(at), at + 1)]);
    }
    expect(settlement.runningIds()).toHaveLength(RUNNING_IDS);
    expect(settlement.runningIds()).not.toContain("0");
    expect(settlement.end([row("1", 1, 1)])).toHaveLength(1);
    expect(settlement.runningIds()).toEqual([]);
  });

  it("queries from a day before `since`, so a message created before it can still end inside the window", () => {
    expect(opencodeQueryFloor(undefined)).toBe(0);
    expect(opencodeQueryFloor(5 * LONGEST_MESSAGE_MS)).toBe(4 * LONGEST_MESSAGE_MS);
  });

  it("continues from a saved state, and stays silent about the messages it already reported", () => {
    const first = createOpencodeSettlement("opencode.db", { final: false });
    first.push([row("1", 10, 10)]);
    const second = createOpencodeSettlement("opencode.db", { state: first.save(), final: false });
    expect(second.position()).toEqual({ row: 1, updated: 10, id: "1" });
    expect(second.push([row("1", 10, 10)])).toHaveLength(0);
    expect(second.push([row("1", 11, 11)])).toHaveLength(0);
    expect(second.push([row("2", 12, 12)])).toHaveLength(1);
  });
});
