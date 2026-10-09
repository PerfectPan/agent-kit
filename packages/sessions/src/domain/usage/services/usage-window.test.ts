import { describe, expect, it } from "vite-plus/test";

import type { UsageRecord } from "../value-objects/usage-record.js";
import { restoreUsageWindow } from "./usage-window.js";

const DAY_MS = 24 * 60 * 60 * 1000;

const record = (agent: string, key: string, timestamp: number): UsageRecord =>
  ({
    agent,
    sessionId: "s",
    granularity: "request",
    requestId: key,
    timestamp,
    usage: {},
    source: { file: "f", offset: 0, length: 0, line: 1 }
  }) as UsageRecord;

describe("usage window", () => {
  it("counts a request once, by agent and key, whatever the day of the later record", () => {
    const window = restoreUsageWindow({}, undefined);
    expect(window.count(record("codex", "s 1", 3 * DAY_MS), "s 1")).toBe(true);
    expect(window.count(record("codex", "s 1", 3 * DAY_MS + 5), "s 1")).toBe(false);
    expect(window.count(record("codex", "s 1", 4 * DAY_MS), "s 1")).toBe(false);
    expect(window.count(record("claude-code", "s 1", 3 * DAY_MS), "s 1")).toBe(true);
  });

  it("round-trips through the scan state, and drops the days that ended before `since`", () => {
    const window = restoreUsageWindow({}, undefined);
    window.count(record("codex", "old", 2 * DAY_MS), "old");
    window.count(record("codex", "new", 6 * DAY_MS + 1), "new");
    const saved = window.save();

    const full = restoreUsageWindow(saved, undefined);
    expect(full.count(record("codex", "old", 2 * DAY_MS), "old")).toBe(false);
    const after = restoreUsageWindow(saved, 6 * DAY_MS + 1);
    expect(after.count(record("codex", "old", 2 * DAY_MS), "old")).toBe(true);
    expect(after.count(record("codex", "new", 6 * DAY_MS + 1), "new")).toBe(false);
  });
});
