import { describe, expect, it } from "vite-plus/test";

import { filterDependencyUpdates } from "./renovate-changeset.ts";
import type { WorkspacePackage } from "./workspace.ts";

const packages: WorkspacePackage[] = [
  {
    dir: "packages/public",
    manifest: {
      dependencies: { zod: "catalog:" },
      optionalDependencies: { optional: "catalog:" },
      peerDependencies: { peer: "catalog:" },
      devDependencies: { "@types/node": "catalog:", publint: "catalog:", shared: "catalog:" }
    }
  },
  { dir: "packages/other", manifest: { private: false, dependencies: { shared: "catalog:" } } },
  { dir: "packages/private", manifest: { private: true, dependencies: { internal: "catalog:" } } }
];

describe("filterDependencyUpdates", () => {
  it("drops dev-only catalog updates while preserving frontmatter, prose and line endings", () => {
    const header = '---\r\n"@scope/public": patch\r\n---\r\n\r\nRuntime updates.\r\n';
    const runtime = "Updated dependency `zod` to `^4.6.8`.\r\n";
    const dev = "Updated dependency `@types/node` to `^24.19.3`.\r\nUpdated dependency `publint` to `^0.3.26`.\r\n";
    expect(filterDependencyUpdates(header + runtime + dev, packages)).toBe(header + runtime);
  });

  it("keeps optional, peer and runtime-in-another-public-package updates, excluding private dependencies", () => {
    const kept = ["optional", "peer", "shared"].map((name) => `Updated dependency \`${name}\` to \`2\`.\n`).join("");
    expect(filterDependencyUpdates(kept + "Updated dependency `internal` to `2`.\n", packages)).toBe(kept);
  });

  it("leaves the complete file unchanged when every update would be removed", () => {
    const original = '---\n"@scope/public": patch\n---\n\nUpdated dependency `publint` to `2`.\n';
    expect(filterDependencyUpdates(original, packages)).toBe(original);
    expect(filterDependencyUpdates(original, [])).toBe(original);
  });

  it("leaves unrecognized summaries unchanged", () => {
    const original = '---\n"@scope/public": patch\n---\n\nUpdate bundled dependencies.';
    expect(filterDependencyUpdates(original, packages)).toBe(original);
  });
});
