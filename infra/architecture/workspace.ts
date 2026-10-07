import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import type { SourceFile, Workspace, WorkspacePackage } from "./check-boundaries.ts";

interface Manifest {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
}

const readJson = <T>(path: string): T => JSON.parse(readFileSync(path, "utf8")) as T;

/** Reads the Rush projects under `packages/` and every non-test code file under their `src/`. */
export function loadWorkspace(root: string): Workspace {
  const { projects } = readJson<{ projects: { packageName: string; projectFolder: string }[] }>(
    join(root, "rush.json")
  );
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
