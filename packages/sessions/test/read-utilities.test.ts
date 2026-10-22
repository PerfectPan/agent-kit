import { describe, expect, it } from "vite-plus/test";
import * as z from "zod/mini";
import { basenamePath, belowRoot, dirnamePath, joinPath } from "../src/lib/paths.js";
import { timeOf } from "../src/lib/time.js";
import { timeOfValue, logTimestamp } from "../src/lib/timestamp.js";
import { lenient } from "../src/lib/lenient.js";
import { rememberKey } from "../src/lib/remember-key.js";
import { shortHash } from "../src/lib/short-hash.js";

describe("literal path spelling", () => {
  it.each([
    ["", "", ""],
    ["/u/me", "a/../b", "/u/me/a/../b"],
    ["/u/me/", "/a", "/u/me/a"],
    ["/u//me", "./a", "/u//me/./a"],
    ["C:\\Users\\me", "sessions", "C:\\Users\\me/sessions"],
    ["//server/share/", "a", "//server/share/a"],
    ["/u/me", "back\\slash", "/u/me/back\\slash"]
  ])("joins %j and %j without normalization", (dir, name, expected) => {
    expect(joinPath(dir, name)).toBe(expected);
  });
  it.each([
    ["", "", "."],
    ["/u/me/", "", "/u/me"],
    ["/u/me/a", "a", "/u/me"],
    ["C:\\Users\\me", "C:\\Users\\me", "."],
    ["c:/Users/me", "me", "c:/Users"],
    ["/u/back\\slash", "back\\slash", "/u"],
    ["//server/share/a", "a", "//server/share"]
  ])("splits %j on forward slashes only", (path, baseName, dirName) => {
    expect(basenamePath(path)).toBe(baseName);
    expect(dirnamePath(path)).toBe(dirName);
  });
  it.each([
    ["/u/me/a/../b", "/u/me", "a/../b"],
    ["/u/me", "/u/me", "/u/me"],
    ["/u/other/a", "/u/me", "/u/other/a"],
    ["C:\\Users\\me/a", "C:\\Users\\me", "a"],
    ["/u/me//a", "/u/me/", "a"],
    ["/u/me/a", "/", "/u/me/a"]
  ])("retains literal source identity below %j", (path, root, expected) => {
    expect(belowRoot(path, root)).toBe(expected);
  });
});

it("keeps timestamp conversion and lenient field boundaries", () => {
  expect(timeOf(12)).toBe(12000);
  expect(timeOf(1e12)).toBe(1e12);
  expect(timeOf("2026-01-01T00:00:00Z")).toBe(1767225600000);
  expect(timeOf("bad")).toBeUndefined();
  expect(timeOf(Number.NaN)).toBeUndefined();
  expect(timeOfValue({ timestamp: 12 })).toBe(12000);
  expect(timeOfValue(null)).toBeUndefined();
  expect(z.parse(logTimestamp, false)).toBeUndefined();
  expect(z.parse(lenient(z.string()), undefined)).toBeUndefined();
  expect(z.parse(lenient(z.string()), "text")).toBe("text");
  expect(z.parse(lenient(z.array(z.string())), ["text", 1])).toBeUndefined();
  expect(z.parse(z.array(lenient(z.string())), ["text", 1])).toEqual(["text", undefined]);
});

it("retains only the bounded recent keys, including duplicates", () => {
  const keys = ["a", "b"];
  rememberKey(keys, "b", 2);
  expect(keys).toEqual(["b", "b"]);
  rememberKey(keys, "c", 0);
  expect(keys).toEqual([]);
});

it("keeps cursor hash encoding", () => {
  expect(shortHash("")).toBe("Gu6Ng0iL3");
  expect(shortHash("request:1")).toBe("KFcPZYfjH");
});
