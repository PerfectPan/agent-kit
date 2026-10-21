import { existsSync, readFileSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { lint as sharedLint } from "@perfectpan/lint-config/vite-plus";
import { isEqual } from "es-toolkit";
import type { OxlintConfig } from "vite-plus/lint";
import { describe, expect, it } from "vite-plus/test";

import { boundaries } from "./boundaries.ts";
import { boundaryLintOf, withBoundaryLint, workspaceProjects } from "./lint.ts";

interface WorkspacePackage {
  readonly name: string;
  /** Repository-relative POSIX path, such as `packages/platform`. */
  readonly folder: string;
  /** Dependencies declared with the `workspace:` protocol in any dependency field of `package.json`. */
  readonly workspaceDependencies: readonly string[];
}

interface Manifest {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
}

const root = realpathSync(fileURLToPath(new URL("../..", import.meta.url)));
const projects = workspaceProjects(root).filter(({ folder }) => folder.startsWith("packages/"));
const packages: WorkspacePackage[] = projects.map(({ name, folder }) => {
  const manifest = JSON.parse(readFileSync(join(root, folder, "package.json"), "utf8")) as Manifest;
  const dependencies = { ...manifest.dependencies, ...manifest.devDependencies, ...manifest.peerDependencies };
  return {
    name,
    folder,
    workspaceDependencies: Object.keys(dependencies).filter((key) => dependencies[key]?.startsWith("workspace:"))
  };
});
const onDisk = (path: string) => existsSync(join(root, path));

/**
 * The boundary rules that concern manifests rather than source files, which `vp lint` cannot see: every package is
 * declared in `boundaries.ts`, its `package.json` declares only allowed workspace dependencies (also when no source
 * file imports them), and its entry files exist.
 */
function manifestViolations(workspace: readonly WorkspacePackage[], exists: (path: string) => boolean): string[] {
  const internal = Object.entries(boundaries.packages)
    .filter(([, rule]) => rule.entries === undefined)
    .map(([name]) => name);
  return workspace.flatMap((pkg) => {
    const isShell = boundaries.shells.includes(pkg.name);
    const rule = boundaries.packages[pkg.name];
    if (rule === undefined && !isShell) {
      return [`${pkg.folder}: undeclared-package ${pkg.name}`];
    }
    const entries =
      rule === undefined
        ? []
        : (rule.entries?.map((entry) => `src/${entry}/public.ts`) ?? ["src/index.ts", "src/public.ts"]);
    const allowed = isShell ? internal : [...(rule?.dependsOn ?? []), ...(rule?.testsOnly ?? [])];
    return [
      ...entries
        .filter((entry) => !exists(`${pkg.folder}/${entry}`))
        .map((entry) => `${pkg.folder}: entry-file ${entry}`),
      ...pkg.workspaceDependencies
        .filter((dependency) => !allowed.includes(dependency))
        .map((dependency) => `${pkg.folder}: package-dependency ${dependency}`)
    ];
  });
}

/**
 * The parts of the boundary rules that a package's lint block lacks. `pnpm -r run lint` runs `vp lint` in each
 * package, and oxlint reads only that package's `lint` block, so each block must carry the rules for its own folder.
 */
function missingBoundaryRules(lint: OxlintConfig | undefined, folder: string): string[] {
  const boundary = boundaryLintOf(folder);
  const has = <T>(own: readonly T[] | null | undefined, expected: readonly T[]): boolean =>
    expected.every((item) => own?.some((candidate) => isEqual(candidate, item)) === true);
  return [
    ...(has(lint?.jsPlugins, boundary.jsPlugins) ? [] : ["jsPlugins"]),
    ...(Object.entries(boundary.settings).every(([key, value]) => isEqual(lint?.settings?.[key], value))
      ? []
      : ["settings"]),
    ...(has(lint?.overrides, boundary.overrides) ? [] : ["overrides"])
  ];
}

async function lintBlockOf(folder: string): Promise<OxlintConfig | undefined> {
  const config = (await import(pathToFileURL(join(root, folder, "vite.config.ts")).href)) as {
    default: { lint?: OxlintConfig };
  };
  return config.default.lint;
}

const SESSIONS = "@rivus/agent-kit-sessions";

describe("the package manifests", () => {
  it("list the packages from pnpm", () => {
    expect(packages.map(({ name }) => name)).toEqual(
      expect.arrayContaining([SESSIONS, "@rivus/agent-kit", "@rivus/agent-kit-collab"])
    );
  });

  it("match the boundary manifest", () => {
    expect(manifestViolations(packages, onDisk)).toEqual([]);
  });

  it("reject a package under packages/ that the manifest does not declare", () => {
    const stray = { name: "@rivus/agent-kit-stray", folder: "packages/stray", workspaceDependencies: [] };
    expect(manifestViolations([...packages, stray], onDisk)).toEqual([
      "packages/stray: undeclared-package @rivus/agent-kit-stray"
    ]);
  });

  it("reject a declared workspace dependency that no source file imports", () => {
    const withTesting = packages.map((pkg) =>
      pkg.name === SESSIONS
        ? { ...pkg, workspaceDependencies: [...pkg.workspaceDependencies, "@rivus/agent-kit-testing"] }
        : pkg
    );
    expect(manifestViolations(withTesting, onDisk)).toEqual([
      "packages/sessions: package-dependency @rivus/agent-kit-testing"
    ]);
  });

  it("keep collab out of the shell's dependencies", () => {
    const withCollab = packages.map((pkg) =>
      pkg.name === "@rivus/agent-kit"
        ? { ...pkg, workspaceDependencies: [...pkg.workspaceDependencies, "@rivus/agent-kit-collab"] }
        : pkg
    );
    expect(manifestViolations(withCollab, onDisk)).toEqual([
      "packages/agent-kit: package-dependency @rivus/agent-kit-collab"
    ]);
  });

  it("require the entry files", () => {
    expect(manifestViolations(packages, (path) => path !== "packages/sessions/src/public.ts" && onDisk(path))).toEqual([
      "packages/sessions: entry-file src/public.ts"
    ]);
  });
});

describe("the lint configuration", () => {
  it.each(projects.map(({ folder }) => folder))(
    "of %s applies the boundary rules",
    async (folder) => {
      expect(missingBoundaryRules(await lintBlockOf(folder), folder)).toEqual([]);
    },
    30_000
  );

  it("reports a package whose lint block lacks the boundary rules", () => {
    expect(missingBoundaryRules(sharedLint, "packages/sessions")).toEqual(["jsPlugins", "settings", "overrides"]);
    const otherFolder = withBoundaryLint(sharedLint, pathToFileURL(join(root, "packages/cost/vite.config.ts")).href);
    expect(missingBoundaryRules(otherFolder, "packages/sessions")).toEqual(["overrides"]);
  });
});
