import { describe, expect, it } from "vite-plus/test";

import { locatorKey } from "../../domain/install-plan/value-objects/artifact-locator.js";
import { isLegacyArtifact, legacyTexts } from "./legacy-artifact.js";

const locator = { kind: "file" as const, path: "/home/example/hook" };
const hash = `sha256:${"1".repeat(64)}` as const;

describe("legacy content boundary", () => {
  it("only supplies text or a validated command to marker matching", () => {
    expect(isLegacyArtifact(["example"], { command: "example hook", type: "command" })).toBe(true);
    expect(isLegacyArtifact(["example"], { command: 1 })).toBe(false);
    expect(isLegacyArtifact(["example"], { command: null })).toBe(false);
    expect(isLegacyArtifact(["example"], null)).toBe(false);
    expect(isLegacyArtifact(["example"], ["example hook"])).toBe(false);
  });

  it("uses the last observation at a locator even when it has no legacy text", () => {
    const first = { locator, hash, content: { command: "example hook" } };
    expect(legacyTexts([first]).get(locatorKey(locator))).toBe("example hook");
    expect(legacyTexts([first, { locator, hash }]).get(locatorKey(locator))).toBeUndefined();
    expect(
      legacyTexts([first, { locator, hash, content: { other: "example hook" } }]).get(locatorKey(locator))
    ).toBeUndefined();
    expect(legacyTexts([first, { locator, hash, content: "new hook" }]).get(locatorKey(locator))).toBe("new hook");
  });
});
