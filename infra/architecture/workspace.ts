import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, realpathSync } from "node:fs";
import { join, relative } from "node:path";

import type { SourceFile, Workspace, WorkspacePackage } from "./check-boundaries.ts";

interface Manifest {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
}

const readJson = <T>(path: string): T => JSON.parse(readFileSync(path, "utf8")) as T;

/**
 * The workspace projects as `pnpm ls -r --depth -1 --json` lists them. pnpm decides membership from the globs in
 * pnpm-workspace.yaml, so a new folder under `packages/` is checked without registering it. pnpm reports real paths,
 * so the folders are taken relative to the resolved root.
 */
function listProjects(root: string): { packageName: string; projectFolder: string }[] {
  const realRoot = realpathSync(root);
  const listed = JSON.parse(
    execFileSync("pnpm", ["ls", "-r", "--depth", "-1", "--json"], {
      cwd: root,
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024
    })
  ) as { name: string; path: string }[];
  return listed.map(({ name, path }) => ({
    packageName: name,
    projectFolder: relative(realRoot, path).split("\\").join("/")
  }));
}

/** Reads the workspace projects under `packages/` and every non-test code file under their `src/`. */
export function loadWorkspace(root: string): Workspace {
  const projects = listProjects(root);
  const packages: WorkspacePackage[] = [];
  const files: SourceFile[] = [];
  for (const project of projects.filter(({ projectFolder }) => projectFolder.startsWith("packages/"))) {
    const manifest = readJson<Manifest>(join(root, project.projectFolder, "package.json"));
    const dependencies = { ...manifest.dependencies, ...manifest.devDependencies, ...manifest.peerDependencies };
    packages.push({
      name: project.packageName,
      folder: project.projectFolder,
      workspaceDependencies: Object.keys(dependencies).filter((name) => dependencies[name]?.startsWith("workspace:"))
    });
    const sourceRoot = join(root, project.projectFolder, "src");
    for (const entry of readdirSync(sourceRoot, { recursive: true, encoding: "utf8" })) {
      if (/\.[cm]?[jt]sx?$/.test(entry) && !/\.(test|spec)\.[cm]?[jt]sx?$/.test(entry)) {
        const path = `${project.projectFolder}/src/${entry.split("\\").join("/")}`;
        files.push({ path, source: readFileSync(join(sourceRoot, entry), "utf8") });
      }
    }
  }
  return { packages, files };
}
