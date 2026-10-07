import { describe, expect, it } from "vitest";

import {
  bundlersOf,
  type FileChange,
  type PackageManifest,
  parseNameStatus,
  type ReleaseInput,
  releaseErrors,
  releaseIntent,
  releasesOf,
  type RushProject
} from "./workspace.ts";

const projects: RushProject[] = [
  { packageName: "@scope/lib", projectFolder: "packages/lib", versionPolicyName: "main" },
  { packageName: "@scope/lib-core", projectFolder: "packages/core", shouldPublish: false },
  { packageName: "@scope/tool", projectFolder: "packages/tool", versionPolicyName: "main" },
  { packageName: "repo-scripts", projectFolder: "scripts", shouldPublish: false }
];

const manifests = new Map<string, PackageManifest>([
  ["@scope/lib", { devDependencies: { "@scope/lib-core": "workspace:*", vitest: "5.0.3" } }],
  ["@scope/tool", { dependencies: { "@scope/lib": "workspace:*" } }]
]);
const bundlers = bundlersOf(projects, manifests);

describe("bundlersOf", () => {
  it("maps a private workspace dependency to the published packages that bundle it", () => {
    expect([...bundlers]).toEqual([["@scope/lib-core", ["@scope/lib"]]]);
  });
});

describe("releasesOf", () => {
  it.each([
    ["packages/lib/src/index.ts", ["@scope/lib"]],
    ["packages/lib/package.json", ["@scope/lib"]],
    ["packages/core/src/domain/x.ts", ["@scope/lib"]],
    ["packages/core/package.json", ["@scope/lib"]],
    ["packages/lib/src/index.test.ts", []],
    ["packages/core/src/x.test.ts", []],
    ["packages/lib/fixtures/input.json", []],
    ["packages/lib/README.md", []],
    ["scripts/check-release.ts", []],
    ["docs/development/release.md", []]
  ])("%s -> %j", (path, expected) => {
    expect(releasesOf(path, projects, bundlers)).toEqual(expected);
  });
});

describe("parseNameStatus", () => {
  it("reads the NUL-separated status and path pairs of git diff --name-status -z", () => {
    expect(parseNameStatus("M\0packages/core/src/x.ts\0D\0common/changes/@scope/lib/a b.json\0")).toEqual([
      { status: "M", path: "packages/core/src/x.ts" },
      { status: "D", path: "common/changes/@scope/lib/a b.json" }
    ]);
  });
});

describe("releaseIntent", () => {
  const modified = (path: string): FileChange => ({ status: "M", path });
  const change = (name: string, status = "A"): FileChange => ({
    status,
    path: `common/changes/${name}/branch_2026-10-07-00-00.json`
  });
  const internal = modified("packages/core/src/domain/x.ts");

  it("requires a change file for the bundling package when only a private bundled package changed", () => {
    expect(releaseIntent([internal], projects, bundlers)).toEqual({
      shipped: ["packages/core/src/domain/x.ts"],
      changeFiles: [],
      missing: ["@scope/lib"],
      unrecordedLockfile: false
    });
  });

  it("does not accept another package's change file for it", () => {
    expect(releaseIntent([internal, change("@scope/tool")], projects, bundlers).missing).toEqual(["@scope/lib"]);
  });

  it("passes when the bundling package has an added or modified change file", () => {
    expect(releaseIntent([internal, change("@scope/lib")], projects, bundlers).missing).toEqual([]);
    expect(releaseIntent([internal, change("@scope/lib", "M")], projects, bundlers).missing).toEqual([]);
  });

  it("does not count a change file that the change deletes", () => {
    const result = releaseIntent([internal, change("@scope/lib", "D")], projects, bundlers);
    expect(result.changeFiles).toEqual([]);
    expect(result.missing).toEqual(["@scope/lib"]);
  });

  it("asks for any change file when only the lockfile changed", () => {
    const lockfile = modified("common/config/rush/pnpm-lock.yaml");
    expect(releaseIntent([lockfile], projects, bundlers)).toEqual({
      shipped: [lockfile.path],
      changeFiles: [],
      missing: [],
      unrecordedLockfile: true
    });
    expect(releaseIntent([lockfile, change("@scope/tool")], projects, bundlers).unrecordedLockfile).toBe(false);
    expect(releaseIntent([lockfile, change("@scope/tool", "D")], projects, bundlers).unrecordedLockfile).toBe(true);
  });

  it("ignores changes that ship nothing", () => {
    const changes = [modified("packages/core/src/x.test.ts"), modified("README.md")];
    expect(releaseIntent(changes, projects, bundlers).shipped).toEqual([]);
  });

  it("counts a deleted source file as shipped", () => {
    expect(releaseIntent([{ status: "D", path: "packages/core/src/old.ts" }], projects, bundlers).missing).toEqual([
      "@scope/lib"
    ]);
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
