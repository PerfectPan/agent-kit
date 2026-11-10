import { execFileSync } from "node:child_process";
import { readFileSync, realpathSync } from "node:fs";
import { join, relative } from "node:path";

export interface PackageManifest {
  name?: string;
  version?: string;
  private?: boolean;
  files?: string[];
  publishConfig?: { access?: string };
  repository?: string | { url?: string };
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
}

/** A workspace member other than the root project, with its manifest. */
export interface WorkspacePackage {
  /** Repository-relative directory with forward slashes, such as `packages/agent-kit`. */
  dir: string;
  manifest: PackageManifest;
}

/** The absolute repository root, resolved so that it matches the paths `pnpm ls` reports. */
export function findRepositoryRoot(): string {
  return realpathSync(execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim());
}

/**
 * Parses `pnpm ls -r --depth -1 --json` output into workspace-relative directories. pnpm decides membership from
 * pnpm-workspace.yaml; the root project it also lists holds only the shortcuts and is left out.
 */
export function parseWorkspaceDirectories(root: string, json: string): string[] {
  const listed = JSON.parse(json) as { path: string }[];
  return listed.map(({ path }) => relative(root, path).split("\\").join("/")).filter((dir) => dir !== "");
}

/** Lists the workspace members through pnpm and reads their manifests. */
export function readWorkspacePackages(root: string): WorkspacePackage[] {
  const listed = execFileSync("pnpm", ["ls", "-r", "--depth", "-1", "--json"], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024
  });
  return parseWorkspaceDirectories(root, listed).map((dir) => ({
    dir,
    manifest: JSON.parse(readFileSync(join(root, dir, "package.json"), "utf8")) as PackageManifest
  }));
}

/**
 * A package publishes when it is not private. Private packages and ignored packages are never versioned or
 * released, so release notes must not name them; the renovate changeset filter relies on that.
 */
export function isPublishable(pkg: WorkspacePackage): boolean {
  return pkg.manifest.private !== true;
}
