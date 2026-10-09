import { describe, expect, it } from "vite-plus/test";

import type { ObservedArtifact } from "./observed-artifact.js";
import { isBrokenSymlink } from "./observed-artifact.js";

const seen = (overrides: Partial<ObservedArtifact>): ObservedArtifact => ({
  locator: { kind: "symlink", path: "/u/me/.agents/skills/demo" },
  hash: `sha256:${"0".repeat(64)}`,
  ...overrides
});

describe("isBrokenSymlink", () => {
  it("is true for a symlink locator whose target has nothing, and for nothing else", () => {
    expect(isBrokenSymlink(seen({ symlinkTarget: "/gone/target", content: "" }))).toBe(true);
    expect(isBrokenSymlink(seen({ symlinkTarget: "/gone/target", content: "text" }))).toBe(false);
    expect(isBrokenSymlink(seen({ content: "" }))).toBe(false);
    expect(isBrokenSymlink(seen({ symlinkTarget: "/live/target", locator: { kind: "file", path: "/u/me/f" } }))).toBe(
      false
    );
  });
});
