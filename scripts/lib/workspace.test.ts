import { describe, expect, it } from "vite-plus/test";

import { isPublishable, parseWorkspaceDirectories } from "./workspace.ts";

describe("parseWorkspaceDirectories", () => {
  it("maps pnpm ls output to workspace-relative directories without the root project", () => {
    const json = JSON.stringify([
      { name: "agent-kit", path: "/repo", private: true },
      { name: "@scope/lib", version: "1.2.3", path: "/repo/packages/lib", private: false },
      { name: "@scope/lib-core", version: "0.0.0", path: "/repo/packages/core", private: true },
      { name: "repo-scripts", version: "0.0.0", path: "/repo/scripts", private: true }
    ]);
    expect(parseWorkspaceDirectories("/repo", json)).toEqual(["packages/lib", "packages/core", "scripts"]);
  });
});

describe("isPublishable", () => {
  it("is false for private packages", () => {
    expect(isPublishable({ dir: "packages/lib", manifest: { name: "@scope/lib" } })).toBe(true);
    expect(isPublishable({ dir: "scripts", manifest: { name: "repo-scripts", private: true } })).toBe(false);
  });
});
