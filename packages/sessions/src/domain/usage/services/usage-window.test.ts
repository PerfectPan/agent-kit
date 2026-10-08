import { describe, expect, it } from "vitest";

import type { UsageRecord } from "../value-objects/usage-record.js";
import { keylessRecordRead, nextMark, type UsageScanMark } from "../value-objects/scan-state.js";
import { QUIET_MS, decodeIsFinal, isQuiet } from "../policies/quiet.js";
import { scanSources, type ScanSourceEntry } from "./scan-sources.js";
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
    source: {
      file: "f",
      offset: 0,
      length: 0,
      line: 1
    }
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

describe("scan sources", () => {
  interface Entry extends ScanSourceEntry {
    readonly cursor?: number;
  }

  const entry = (agent: string, path: string, mtimeMs: number, cursor?: number): Entry => ({
    agent: agent as Entry["agent"],
    path,
    mtimeMs,
    ...(cursor === undefined ? {} : { cursor })
  });

  it("keeps a source's entry when its agent moves the file, and gives a copy its own key", () => {
    const sources = scanSources<Entry>({ "codex a": entry("codex", "/old/a.jsonl", 5, 1) });
    expect(sources.take({ agent: "codex", id: "a", path: "/new/a.jsonl" }, false)).toEqual({
      key: "codex a",
      known: entry("codex", "/old/a.jsonl", 5, 1)
    });
    sources.set("codex a", entry("codex", "/new/a.jsonl", 6, 3));
    const copy = sources.take({ agent: "codex", id: "a", path: "/here/a.jsonl" }, true);
    expect(copy.known).toBeUndefined();
    sources.set(copy.key, entry("codex", "/here/a.jsonl", 7, 2));
    expect(sources.all()).toEqual({
      "codex a": entry("codex", "/new/a.jsonl", 6, 3),
      "codex a /here/a.jsonl": entry("codex", "/here/a.jsonl", 7, 2)
    });
  });

  it("prunes what this scan did not find: gone, out of the window, or listed without failure", () => {
    const sources = scanSources<Entry>({
      "codex kept": entry("codex", "/r/kept.jsonl", 50),
      "codex old": entry("codex", "/r/old.jsonl", 5),
      "codex failed": entry("codex", "/r/failed/x.jsonl", 50),
      "codex other": entry("codex", "/r/other.jsonl", 50)
    });
    sources.take({ agent: "codex", id: "kept", path: "/r/kept.jsonl" }, false);
    sources.prune({ scanned: new Set(["codex"]), failed: ["/r/failed"], since: 10 });
    expect(sources.all()).toEqual({
      "codex kept": entry("codex", "/r/kept.jsonl", 50),
      "codex failed": entry("codex", "/r/failed/x.jsonl", 50)
    });
  });

  it("keeps the sources of an agent this scan did not cover", () => {
    const sources = scanSources<Entry>({ "pi a": entry("pi", "/r/a.jsonl", 5) });
    sources.prune({ scanned: new Set(["codex"]), failed: [], since: 10 });
    expect(sources.all()).toEqual({ "pi a": entry("pi", "/r/a.jsonl", 5) });
  });
});

describe("quiet sources", () => {
  it("calls a source quiet after half an hour without a write", () => {
    expect(isQuiet(1000, 1000 + QUIET_MS)).toBe(false);
    expect(isQuiet(999, 1000 + QUIET_MS)).toBe(true);
  });

  it("decodes as final when the caller said so, or when the source was quiet at the decode", () => {
    expect(decodeIsFinal({}, 5)).toBe(false);
    expect(decodeIsFinal({ final: true }, 5)).toBe(true);
    expect(decodeIsFinal({ quietBefore: 10 }, 9)).toBe(true);
    expect(decodeIsFinal({ quietBefore: 10 }, 10)).toBe(false);
  });
});
