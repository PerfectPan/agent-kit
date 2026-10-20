import { describe, expect, it } from "vite-plus/test";

import {
  fixedGroupVersion,
  isPublishable,
  type PackageManifest,
  parseWorkspaceDirectories,
  type ReleaseInput,
  releaseErrors,
  releaseState,
  type ReleaseStateInput,
  remoteTagCommit,
  splitScriptArgs,
  type WorkspacePackage
} from "./workspace.ts";

describe("splitScriptArgs", () => {
  it("drops the -- separator pnpm forwards verbatim", () => {
    expect(splitScriptArgs(["--", "v1.2.3", "--repository", "owner/repo"])).toEqual([
      "v1.2.3",
      "--repository",
      "owner/repo"
    ]);
  });

  it("keeps argv without a separator", () => {
    expect(splitScriptArgs(["v1.2.3", "--verify-git"])).toEqual(["v1.2.3", "--verify-git"]);
  });
});

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

function publishable(name: string, extra: PackageManifest = {}): WorkspacePackage {
  return {
    dir: `packages/${name.slice("@scope/".length)}`,
    manifest: {
      name,
      version: "1.2.3",
      files: ["dist"],
      publishConfig: { access: "public" },
      repository: { url: "git+https://github.com/owner/repo.git" },
      ...extra
    }
  };
}

const core: WorkspacePackage = { dir: "packages/core", manifest: { name: "@scope/lib-core", private: true } };
const scripts: WorkspacePackage = { dir: "scripts", manifest: { name: "repo-scripts", private: true } };

function input(overrides: Partial<ReleaseInput> = {}): ReleaseInput {
  return {
    tag: "v1.2.3",
    repository: "owner/repo",
    packages: [publishable("@scope/lib"), core, scripts],
    pendingChangesets: [],
    ...overrides
  };
}

describe("releaseErrors", () => {
  it("accepts a consistent release", () => {
    expect(releaseErrors(input())).toEqual([]);
  });

  it("requires a publishable package", () => {
    expect(releaseErrors(input({ packages: [core, scripts] }))).toContain("the workspace has no published packages");
  });

  it("rejects a tag that does not match the packages' shared version and points at the tag", () => {
    expect(releaseErrors(input({ tag: "v1.2.4" }))).toEqual([
      "release tag v1.2.4 does not match @scope/lib@1.2.3; check the release tag against the shared version of the published packages"
    ]);
  });

  it("rejects two published packages that carry different versions", () => {
    const packages = [publishable("@scope/lib"), publishable("@scope/tool", { version: "2.0.0" })];
    expect(releaseErrors(input({ packages }))).toEqual([
      "release tag v1.2.3 does not match @scope/tool@2.0.0 (all published packages release at one shared version; add every published package to the versioning.fixed group in pnpm-workspace.yaml)"
    ]);
  });

  it("reports a missing tag once", () => {
    expect(releaseErrors(input({ tag: "" }))).toEqual(["release tag is required"]);
  });

  it("rejects a prerelease version", () => {
    const packages = [publishable("@scope/lib", { version: "1.2.3-rc.0" })];
    expect(releaseErrors(input({ tag: "v1.2.3-rc.0", packages }))).toContain(
      '@scope/lib version must be a stable x.y.z release, got "1.2.3-rc.0"'
    );
  });

  it("rejects a manifest from another repository and pending changesets", () => {
    const packages = [publishable("@scope/lib", { repository: "https://github.com/other/repo" })];
    expect(releaseErrors(input({ packages, pendingChangesets: ["next-feature.md"] }))).toEqual([
      "@scope/lib repository.url must identify github.com/owner/repo",
      "unreleased changesets remain; merge the release PR first: next-feature.md"
    ]);
  });

  it("accepts two published packages when the second names the first with workspace:", () => {
    const tool = publishable("@scope/tool", {
      dependencies: { zod: "catalog:" },
      peerDependencies: { "@scope/lib": "workspace:^", effect: "catalog:" },
      devDependencies: { "@scope/lib": "workspace:*", "@scope/lib-core": "workspace:*" }
    });
    expect(releaseErrors(input({ packages: [publishable("@scope/lib"), tool, core] }))).toEqual([]);
  });

  it("rejects a fixed range on another published package and an installed dependency on a private one", () => {
    const tool = publishable("@scope/tool", {
      peerDependencies: { "@scope/lib": "^1.2.3" },
      dependencies: { "@scope/lib-core": "workspace:*" }
    });
    expect(releaseErrors(input({ packages: [publishable("@scope/lib"), tool, core] }))).toEqual([
      "@scope/tool dependencies names @scope/lib-core, which is not published; make it a devDependency",
      '@scope/tool peerDependencies must name @scope/lib with the workspace: protocol, got "^1.2.3"'
    ]);
  });
});

describe("fixedGroupVersion", () => {
  const packages = [publishable("@scope/lib"), publishable("@scope/tool"), core];

  it("reads the version the group's members share", () => {
    expect(fixedGroupVersion([["@scope/lib", "@scope/tool"]], packages)).toEqual({
      members: ["@scope/lib", "@scope/tool"],
      version: "1.2.3"
    });
  });

  it("needs exactly one group", () => {
    const error = (count: number) => ({
      errors: [`automatic releases need exactly one versioning.fixed group in pnpm-workspace.yaml, got ${count}`]
    });
    expect(fixedGroupVersion([], packages)).toEqual(error(0));
    expect(fixedGroupVersion([["@scope/lib"], ["@scope/tool"]], packages)).toEqual(error(2));
  });

  it("rejects members that disagree on the version", () => {
    const lagging = [publishable("@scope/lib"), publishable("@scope/tool", { version: "1.2.2" })];
    expect(fixedGroupVersion([["@scope/lib", "@scope/tool"]], lagging)).toEqual({
      errors: ["the versioning.fixed group must share one version, got @scope/lib@1.2.3, @scope/tool@1.2.2"]
    });
  });

  it("rejects a member that is not a workspace package", () => {
    expect(fixedGroupVersion([["@scope/lib", "@scope/gone"]], packages)).toEqual({
      errors: ["@scope/gone in the versioning.fixed group is not a workspace package with a version"]
    });
  });
});

describe("releaseState", () => {
  const head = "a".repeat(40);
  const state = (overrides: Partial<ReleaseStateInput>) =>
    releaseState({ pendingChangesets: [], version: "0.1.0", head, taggedCommit: undefined, ...overrides });

  it("prepares the release PR while changesets are pending, whatever the tags say", () => {
    expect(state({ pendingChangesets: ["next-feature.md"] })).toBe("version");
    expect(state({ pendingChangesets: ["next-feature.md"], version: "0.0.0" })).toBe("version");
    expect(state({ pendingChangesets: ["next-feature.md"], taggedCommit: "b".repeat(40) })).toBe("version");
  });

  it("publishes a consumed version whose tag is not on the remote", () => {
    expect(state({})).toBe("publish");
  });

  it("resumes a release whose tag an earlier run pushed to this commit", () => {
    expect(state({ taggedCommit: head })).toBe("publish");
  });

  it("does nothing once the version is tagged on another commit", () => {
    expect(state({ taggedCommit: "b".repeat(40) })).toBe("none");
  });

  it("never releases the initial 0.0.0", () => {
    expect(state({ version: "0.0.0" })).toBe("none");
  });
});

describe("remoteTagCommit", () => {
  it("peels an annotated tag to its commit", () => {
    const output = "1111\trefs/tags/v0.1.0\n2222\trefs/tags/v0.1.0^{}\n";
    expect(remoteTagCommit(output, "v0.1.0")).toBe("2222");
  });

  it("reads a lightweight tag directly", () => {
    expect(remoteTagCommit("3333\trefs/tags/v0.1.0\n", "v0.1.0")).toBe("3333");
  });

  it("reports a missing tag and ignores tags with a longer name", () => {
    expect(remoteTagCommit("", "v0.1.0")).toBeUndefined();
    expect(remoteTagCommit("4444\trefs/tags/v0.1.0-rc.1\n", "v0.1.0")).toBeUndefined();
  });
});
