import { execFileSync } from "node:child_process";
import { readFileSync, realpathSync } from "node:fs";
import { join, relative } from "node:path";
import process from "node:process";
import { parseArgs } from "node:util";

import { pnpmListJson } from "../../infra/architecture/workspace.ts";

export function exitOnHelp(usage: string): void {
  const { values } = parseArgs({ options: { help: { type: "boolean", short: "h" } } });
  if (values.help === true) {
    console.log(usage);
    process.exit(0);
  }
}

export interface PackageManifest {
  name?: string;
  version?: string;
  private?: boolean;
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
  return parseWorkspaceDirectories(root, pnpmListJson(root)).map((dir) => ({
    dir,
    manifest: JSON.parse(readFileSync(join(root, dir, "package.json"), "utf8")) as PackageManifest
  }));
}

/**
 * A package publishes when it is not private. `.changeset/config.json` never versions or releases private packages,
 * so release notes must not name them; the renovate changeset filter relies on that.
 */
export function isPublishable(pkg: WorkspacePackage): boolean {
  return pkg.manifest.private !== true;
}
