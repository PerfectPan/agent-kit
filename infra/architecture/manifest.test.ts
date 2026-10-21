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
  readonly lintScript?: string;
  /** Dependencies declared with the `workspace:` protocol in any dependency field of `package.json`. */
  readonly workspaceDependencies: readonly string[];
}

interface Manifest {
  scripts?: Record<string, string>;
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
    lintScript: manifest.scripts?.lint,
    workspaceDependencies: Object.keys(dependencies).filter((key) => dependencies[key]?.startsWith("workspace:"))
  };
});
const onDisk = (path: string) => existsSync(join(root, path));

/**
 * The boundary rules that concern manifests rather than source files, which `vp lint` cannot see: every package is
 * declared in `boundaries.ts`, its `package.json` declares only allowed workspace dependencies (also when no source
 * file imports them), its entry files exist, and recursive lint actually runs `vp lint` for it.
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
      // Keep the whole-package lint mandatory; only the existing output redirect and Effect diagnostics may follow.
      ...(/^vp lint(?: 2>&1)?(?: && effect-tsgo diagnostics --project (?:test\/)?tsconfig\.json --strict)*$/.test(
        pkg.lintScript ?? ""
      )
        ? []
        : [`${pkg.folder}: lint-script must run vp lint`]),
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
    // Later overrides can disable a rule, so withBoundaryLint must append the final overrides in their original order.
    ...(isEqual(lint?.overrides?.slice(-boundary.overrides.length), boundary.overrides) ? [] : ["overrides"]),
    // Restrict ignores to build output; arbitrary globs could silently exclude present or future source files.
    ...((lint?.ignorePatterns ?? []).every((pattern) => pattern === "dist/**") ? [] : ["ignorePatterns"])
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

  it.each([
    "vp lint",
    "vp lint 2>&1",
    "vp lint 2>&1 && effect-tsgo diagnostics --project tsconfig.json --strict && effect-tsgo diagnostics --project test/tsconfig.json --strict"
  ])("accept the whole-package lint script %s", (lintScript) => {
    expect(
      manifestViolations(
        packages.map((pkg) => ({ ...pkg, lintScript })),
        onDisk
      )
    ).toEqual([]);
  });

  it.each([undefined, "", "vp test", "vp lint src/index.ts", "vp lint || true"])(
    "reject a missing or bypassed lint script: %s",
    (lintScript) => {
      const probe = packages.map((pkg) => (pkg.name === SESSIONS ? { ...pkg, lintScript } : pkg));
      expect(manifestViolations(probe, onDisk)).toEqual(["packages/sessions: lint-script must run vp lint"]);
    }
  );

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

  it.each([
    "boundaries/dependencies",
    "boundaries/no-unknown-files",
    "import/no-nodejs-modules",
    "eslint-js/no-restricted-syntax"
  ])("rejects a later override disabling %s", (rule) => {
    const lint = withBoundaryLint(sharedLint, pathToFileURL(join(root, "packages/sessions/vite.config.ts")).href);
    const probe: OxlintConfig = {
      ...lint,
      overrides: [...(lint.overrides ?? []), { files: ["src/**/*.ts"], rules: { [rule]: "off" } }]
    };
    expect(missingBoundaryRules(probe, "packages/sessions")).toEqual(["overrides"]);
  });

  it.each(["src", "src/**", "**/*.ts"])("rejects the source ignore %s", (pattern) => {
    const lint = withBoundaryLint(sharedLint, pathToFileURL(join(root, "packages/sessions/vite.config.ts")).href);
    expect(missingBoundaryRules({ ...lint, ignorePatterns: [pattern] }, "packages/sessions")).toEqual([
      "ignorePatterns"
    ]);
  });

  it("accepts build-output ignores and overrides before the boundary rules", () => {
    const lint = withBoundaryLint(
      {
        ...sharedLint,
        ignorePatterns: ["dist/**"],
        overrides: [{ files: ["src/**/*.ts"], rules: { "boundaries/dependencies": "off" } }]
      },
      pathToFileURL(join(root, "packages/sessions/vite.config.ts")).href
    );
    expect(missingBoundaryRules(lint, "packages/sessions")).toEqual([]);
  });
});
