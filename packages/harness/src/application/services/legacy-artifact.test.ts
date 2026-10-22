import { describe, expect, it } from "vite-plus/test";

import { isLegacyArtifact, legacyTexts } from "./legacy-artifact.js";

const locator = { kind: "file" as const, path: "/u/example/hook" };
const hash = `sha256:${"1".repeat(64)}` as const;

describe("legacy content boundary", () => {
  it("only supplies text or a validated command to marker matching", () => {
    expect(isLegacyArtifact(["example"], { command: "example hook", type: "command" })).toBe(true);
    expect(isLegacyArtifact(["example"], { command: 1 })).toBe(false);
    expect(isLegacyArtifact(["example"], { command: null })).toBe(false);
    expect(isLegacyArtifact(["example"], null)).toBe(false);
    expect(isLegacyArtifact(["example"], ["example hook"])).toBe(false);
  });

  it("keeps each observation's text even when a later observation at the same locator has none", () => {
    const first = { locator, hash, content: { command: "example hook" } };
    const bare = { locator, hash };
    const other = { locator, hash, content: { other: "example hook" } };
    const last = { locator, hash, content: "new hook" };
    const texts = legacyTexts([first, bare, other, last]);
    expect(texts.get(first)).toBe("example hook");
    expect(texts.get(bare)).toBeUndefined();
    expect(texts.get(other)).toBeUndefined();
    expect(texts.get(last)).toBe("new hook");
  });
});
