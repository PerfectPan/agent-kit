import { describe, expect, it } from "vite-plus/test";

import { hasLegacyMarker, isLegacyArtifact } from "./legacy-markers.js";

describe("hasLegacyMarker", () => {
  it.each([
    [["demo-hook"], "npx demo-hook --event Stop", true],
    [["demo-hook", "other"], "npx other --event Stop", true],
    [["demo-hook"], "npx other --event Stop", false],
    [[""], "anything", false],
    [[" ", "\t"], "a text with spaces", false],
    [[], "anything", false]
  ] as const)("markers %j on %j → %s", (markers, text, expected) => {
    expect(hasLegacyMarker([...markers], text)).toBe(expected);
  });
});

describe("isLegacyArtifact", () => {
  it("matches file text, an entry's command, and nothing else", () => {
    expect(isLegacyArtifact(["demo-hook"], "npx demo-hook --event Stop")).toBe(true);
    expect(isLegacyArtifact(["demo-hook"], { type: "command", command: "npx demo-hook --event Stop" })).toBe(true);
    expect(isLegacyArtifact(["demo-hook"], { type: "command", command: "npx other" })).toBe(false);
    expect(isLegacyArtifact(["demo-hook"], { other: "npx demo-hook" })).toBe(false);
    expect(isLegacyArtifact(["demo-hook"], undefined)).toBe(false);
    expect(isLegacyArtifact(["demo-hook"], ["npx demo-hook"])).toBe(false);
  });
});
