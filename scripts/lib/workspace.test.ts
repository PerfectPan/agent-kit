import { describe, expect, it } from "vitest";

import { isShippedChange, type ReleaseInput, releaseErrors, type RushProject } from "./workspace.ts";

const projects: RushProject[] = [
  { packageName: "@scope/lib", projectFolder: "packages/lib", versionPolicyName: "main" },
  { packageName: "repo-scripts", projectFolder: "scripts", shouldPublish: false }
];

describe("isShippedChange", () => {
  it.each([
    ["packages/lib/src/index.ts", true],
    ["packages/lib/package.json", true],
    ["common/config/rush/pnpm-lock.yaml", true],
    ["packages/lib/src/index.test.ts", false],
    ["packages/lib/fixtures/input.json", false],
    ["packages/lib/README.md", false],
    ["scripts/check-release.ts", false],
    ["docs/development/release.md", false]
  ])("%s -> %s", (path, expected) => {
    expect(isShippedChange(path, projects)).toBe(expected);
  });
});

function input(overrides: Partial<ReleaseInput> = {}): ReleaseInput {
  return {
    tag: "v1.2.3",
    repository: "owner/repo",
    policy: { policyName: "main", definitionName: "lockStepVersion", version: "1.2.3" },
    packages: [
      {
        project: projects[0]!,
        manifest: {
          name: "@scope/lib",
          version: "1.2.3",
          files: ["dist"],
          publishConfig: { access: "public" },
          repository: { url: "git+https://github.com/owner/repo.git" }
        }
      }
    ],
    pendingChangeFiles: [],
    ...overrides
  };
}

describe("releaseErrors", () => {
  it("accepts a consistent lockstep release", () => {
    expect(releaseErrors(input())).toEqual([]);
  });

  it("rejects a tag that does not match the policy version", () => {
    expect(releaseErrors(input({ tag: "v1.2.4" }))).toEqual([
      "release tag v1.2.4 does not match policy version v1.2.3"
    ]);
  });

  it("rejects a prerelease policy version", () => {
    const policy = { policyName: "main", definitionName: "lockStepVersion", version: "1.2.3-rc.0" } as const;
    expect(releaseErrors(input({ tag: "v1.2.3-rc.0", policy }))).toContain(
      'policy main version must be a stable x.y.z release, got "1.2.3-rc.0"'
    );
  });

  it("rejects a manifest from another repository and pending change files", () => {
    const [entry] = input().packages;
    const manifest = { ...entry!.manifest, repository: "https://github.com/other/repo" };
    expect(
      releaseErrors(input({ packages: [{ ...entry!, manifest }], pendingChangeFiles: ["@scope/lib/x.json"] }))
    ).toEqual([
      "@scope/lib repository.url must identify github.com/owner/repo",
      "unreleased change files remain; run Version Packages first: @scope/lib/x.json"
    ]);
  });
});
