import { describe, expect, it } from "vite-plus/test";

import { budgetFor, parseMeasurements, rewriteLimits } from "./size-budgets.ts";

describe("budgetFor", () => {
  it("adds 256 B to entries under 12.8 kB", () => {
    expect(budgetFor("@rivus/x", 0)).toBe(256);
    expect(budgetFor("@rivus/x", 1945)).toBe(2201);
    expect(budgetFor("@rivus/x", 12_800)).toBe(13_056);
  });

  it("adds 2%, rounded up, to larger entries", () => {
    expect(budgetFor("@rivus/x", 12_801)).toBe(13_058);
    expect(budgetFor("@rivus/x", 82_828)).toBe(84_485);
  });

  it("keeps 512 B of room for the LiteLLM snapshot's new models", () => {
    expect(budgetFor("@rivus/agent-kit/cost/prices", 2974)).toBe(3486);
  });
});

describe("parseMeasurements", () => {
  it("keeps the name and size of each entry", () => {
    const json = JSON.stringify([{ name: "a", passed: true, size: 10, sizeLimit: 12 }]);
    expect(parseMeasurements(json)).toEqual([{ name: "a", size: 10 }]);
  });

  it("rejects an entry without a size", () => {
    expect(() => parseMeasurements(JSON.stringify([{ name: "a", passed: false }]))).toThrow(/size/);
  });
});

describe("rewriteLimits", () => {
  const source = [
    "export default [",
    '  // About "@rivus/x/a": a comment that mentions the name.',
    '  { name: "@rivus/x/a", path: "dist/a.js", import: "*", limit: "100 B" },',
    '  { name: "@rivus/x/a/b", path: "dist/a/b.js", import: "*", limit: "200 B", ...nodeOnly }',
    "];",
    ""
  ].join("\n");

  it("replaces only the limits of the measured entries", () => {
    expect(rewriteLimits(source, [{ name: "@rivus/x/a/b", size: 1000 }])).toBe(
      source.replace('limit: "200 B"', 'limit: "1256 B"')
    );
  });

  it("does not match an entry whose name only starts with the measured name", () => {
    const text = rewriteLimits(source, [{ name: "@rivus/x/a", size: 50 }]);
    expect(text).toContain('limit: "306 B" }');
    expect(text).toContain('limit: "200 B", ...nodeOnly');
  });

  it("throws for an entry the source does not declare", () => {
    expect(() => rewriteLimits(source, [{ name: "@rivus/x/c", size: 1 }])).toThrow(/found 0/);
  });
});
