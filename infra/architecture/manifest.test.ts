import { existsSync, globSync, readFileSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { lint as sharedLint } from "@perfectpan/lint-config/vite-plus";
import { isEqual, pickBy } from "es-toolkit";
import type { OxlintConfig } from "vite-plus/lint";
import { describe, expect, it } from "vite-plus/test";

import { boundaries } from "./boundaries.ts";
import { extractAgentMarkers } from "./agent-markers.ts";
import { boundaryLintOf, withBoundaryLint, workspaceProjects } from "./lint.ts";

interface WorkspacePackage extends Manifest {
  readonly name: string;
  /** Repository-relative POSIX path, such as `packages/platform`. */
  readonly folder: string;
  readonly lintScript?: string;
  readonly exports?: Readonly<Record<string, unknown>>;
}

interface Manifest {
  exports?: Record<string, unknown>;
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
}

const root = realpathSync(fileURLToPath(new URL("../..", import.meta.url)));
const projects = workspaceProjects(root).filter(({ folder }) => folder.startsWith("packages/"));
const packages: WorkspacePackage[] = projects.map(({ name, folder }) => {
  const manifest = JSON.parse(readFileSync(join(root, folder, "package.json"), "utf8")) as Manifest;
  return {
    ...manifest,
    name,
    folder,
    lintScript: manifest.scripts?.lint,
    exports: manifest.exports
  };
});
const onDisk = (path: string) => existsSync(join(root, path));

/** Development edges may cycle; only runtime dependencies determine production build direction. */
function productionCycles(workspace: readonly WorkspacePackage[]): string[] {
  const graph = new Map(
    workspace.map((pkg) => [
      pkg.name,
      Object.keys({ ...pkg.dependencies, ...pkg.peerDependencies, ...pkg.optionalDependencies })
    ])
  );
  const visited = new Set<string>();
  const active: string[] = [];
  const cycles: string[] = [];
  function visit(name: string): void {
    const start = active.indexOf(name);
    if (start !== -1) {
      cycles.push(`production-cycle ${[...active.slice(start), name].join(" -> ")}`);
      return;
    }
    if (visited.has(name)) {
      return;
    }
    visited.add(name);
    active.push(name);
    for (const dependency of graph.get(name) ?? []) {
      if (graph.has(dependency)) {
        visit(dependency);
      }
    }
    active.pop();
  }
  for (const name of graph.keys()) {
    visit(name);
  }
  return cycles;
}

/**
 * The boundary rules that concern manifests rather than source files, which `vp lint` cannot see: every package is
 * declared in `boundaries.ts`, its `package.json` declares only allowed workspace dependencies (also when no source
 * file imports them), its entry files exist, and recursive lint actually runs `vp lint` for it.
 */
function manifestViolations(workspace: readonly WorkspacePackage[], exists: (path: string) => boolean): string[] {
  const internal = Object.entries(boundaries.packages)
    .filter(([, rule]) => rule.entries === undefined)
    .map(([name]) => name);
  const violations = workspace.flatMap((pkg) => {
    const isShell = boundaries.shells.includes(pkg.name);
    const rule = boundaries.packages[pkg.name];
    if (rule === undefined && !isShell) {
      return [`${pkg.folder}: undeclared-package ${pkg.name}`];
    }
    const entries = [
      ...(rule === undefined
        ? []
        : (rule.providerServices?.map((service) => `src/${service}.ts`) ??
          rule.entries?.map((entry) => `src/${entry}/public.ts`) ?? ["src/public.ts"])),
      ...(rule?.spi ? ["src/spi.ts"] : [])
    ];
    const allowed = isShell
      ? internal
      : [...(rule?.dependsOn ?? []), ...(rule?.spiImports ?? []), ...(rule?.testsOnly ?? [])];
    return [
      ...(exists(`${pkg.folder}/src/index.ts`) ? [`${pkg.folder}: entry-file forbidden src/index.ts`] : []),
      ...(rule?.providerServices === undefined &&
      rule?.entries === undefined &&
      !isShell &&
      pkg.exports?.["."] !== undefined
        ? [`${pkg.folder}: entry-export unexpected .`]
        : []),
      ...Object.keys({ ...pkg.dependencies, ...pkg.peerDependencies, ...pkg.optionalDependencies })
        .filter((dependency) => rule?.testsOnly?.includes(dependency))
        .map((dependency) => `${pkg.folder}: tests-only-dependency ${dependency} must be in devDependencies only`),
      ...(rule?.providerServices === undefined
        ? []
        : [
            ...rule.providerServices
              .filter((service) => pkg.exports?.[`./${service}`] !== `./src/${service}.ts`)
              .map((service) => `${pkg.folder}: entry-export ./${service}`),
            ...Object.keys(pkg.exports ?? {})
              .filter((entry) => !rule.providerServices?.some((service) => entry === `./${service}`))
              .map((entry) => `${pkg.folder}: entry-export unexpected ${entry}`)
          ]),
      ...(rule?.siblingEntries ?? [])
        .filter((entry) => pkg.exports?.[`./${entry}`] === undefined)
        .map((entry) => `${pkg.folder}: entry-export ./${entry}`),
      ...(rule?.spi && pkg.exports?.["./spi"] !== "./src/spi.ts" ? [`${pkg.folder}: entry-export ./spi`] : []),
      // Keep the whole-package lint mandatory; only the existing output redirect and Effect diagnostics may follow.
      ...(/^vp lint(?: 2>&1)?(?: && effect-tsgo diagnostics --project (?:test\/)?tsconfig\.json --strict)*$/.test(
        pkg.lintScript ?? ""
      )
        ? []
        : [`${pkg.folder}: lint-script must run vp lint`]),
      ...entries
        .filter((entry) => !exists(`${pkg.folder}/${entry}`))
        .map((entry) => `${pkg.folder}: entry-file ${entry}`),
      ...Object.entries({
        ...pkg.dependencies,
        ...pkg.devDependencies,
        ...pkg.peerDependencies,
        ...pkg.optionalDependencies
      })
        .filter(([, version]) => version.startsWith("workspace:"))
        .map(([dependency]) => dependency)
        .filter((dependency) => !allowed.includes(dependency))
        .map((dependency) => `${pkg.folder}: package-dependency ${dependency}`)
    ];
  });
  return [...violations, ...productionCycles(workspace)];
}

/**
 * The parts of the boundary rules that a package's lint block lacks. `pnpm -r run lint` runs `vp lint` in each
 * package, and oxlint reads only that package's `lint` block, so each block must carry the rules for its own folder.
 */
function missingBoundaryRules(lint: OxlintConfig | undefined, folder: string): string[] {
  const boundary = boundaryLintOf(folder);
  const has = <T>(own: readonly T[] | null | undefined, expected: readonly T[]): boolean =>
    expected.every((item) => own?.some((candidate) => isEqual(candidate, item)) === true);
  const settings = pickBy(
    lint?.settings ?? {},
    (_value, key) => key.startsWith("boundaries/") || key.startsWith("import/")
  );
  return [
    ...(has(lint?.jsPlugins, boundary.jsPlugins) ? [] : ["jsPlugins"]),
    // Extra settings such as boundaries/ignore can suppress diagnostics without changing any generated key.
    ...(isEqual(settings, boundary.settings) ? [] : ["settings"]),
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
      expect.arrayContaining([
        SESSIONS,
        "@rivus/agent-kit",
        "@rivus/agent-kit-collab",
        "@rivus/agent-kit-provider-pi",
        "@rivus/agent-kit-provider-cursor",
        "@rivus/agent-kit-provider-gemini-cli"
      ])
    );
  });

  it("match the boundary manifest", () => {
    expect(manifestViolations(packages, onDisk)).toEqual([]);
  });

  it.each(["dependencies", "peerDependencies", "optionalDependencies"] as const)("rejects testsOnly in %s", (field) => {
    const provider = "@rivus/agent-kit-provider-pi";
    const probe = packages.map((pkg) =>
      pkg.name === "@rivus/agent-kit-testing" ? { ...pkg, [field]: { ...pkg[field], [provider]: "workspace:*" } } : pkg
    );
    expect(manifestViolations(probe, onDisk)).toEqual([
      `packages/testing: tests-only-dependency ${provider} must be in devDependencies only`
    ]);
  });

  it("accepts testsOnly in devDependencies", () => {
    const testing = packages.find((pkg) => pkg.name === "@rivus/agent-kit-testing")!;
    for (const provider of [
      "@rivus/agent-kit-provider-pi",
      "@rivus/agent-kit-provider-cursor",
      "@rivus/agent-kit-provider-gemini-cli"
    ]) {
      expect(testing.devDependencies?.[provider]).toBe("workspace:*");
    }
    expect(manifestViolations(packages, onDisk)).toEqual([]);
  });

  it.each(["dependencies", "peerDependencies", "optionalDependencies"] as const)(
    "rejects production cycles through %s",
    (field) => {
      const catalog = "@rivus/agent-kit-catalog";
      const probe = packages.map((pkg) =>
        pkg.name === catalog ? { ...pkg, [field]: { ...pkg[field], [SESSIONS]: "workspace:*" } } : pkg
      );
      expect(manifestViolations(probe, onDisk)).toEqual([
        `packages/catalog: package-dependency ${SESSIONS}`,
        `production-cycle ${catalog} -> ${SESSIONS} -> ${catalog}`
      ]);
    }
  );

  it("accepts an acyclic production graph with a development cycle", () => {
    expect(
      productionCycles([
        { name: "a", folder: "packages/a", dependencies: { b: "workspace:*" } },
        { name: "b", folder: "packages/b", devDependencies: { a: "workspace:*" } }
      ])
    ).toEqual([]);
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
    const stray = { name: "@rivus/agent-kit-stray", folder: "packages/stray" };
    expect(manifestViolations([...packages, stray], onDisk)).toEqual([
      "packages/stray: undeclared-package @rivus/agent-kit-stray"
    ]);
  });

  it.each(["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"] as const)(
    "rejects a forbidden workspace dependency in %s without a source import",
    (field) => {
      const withTesting = packages.map((pkg) =>
        pkg.name === SESSIONS ? { ...pkg, [field]: { ...pkg[field], "@rivus/agent-kit-testing": "workspace:*" } } : pkg
      );
      expect(manifestViolations(withTesting, onDisk)).toEqual([
        "packages/sessions: package-dependency @rivus/agent-kit-testing",
        ...(field === "devDependencies"
          ? []
          : [`production-cycle ${SESSIONS} -> @rivus/agent-kit-testing -> ${SESSIONS}`])
      ]);
    }
  );

  it("accepts SPI-only workspace dependencies without granting the context public entry", () => {
    const name = "@rivus/agent-kit-provider-probe";
    const original = boundaries.packages;
    Object.defineProperty(boundaries, "packages", {
      value: {
        ...original,
        [name]: { siblingEntries: [], dependsOn: [], spiImports: [SESSIONS], external: [] }
      },
      configurable: true
    });
    try {
      expect(
        manifestViolations(
          [
            {
              name,
              folder: "packages/providers/probe",
              lintScript: "vp lint",
              dependencies: { [SESSIONS]: "workspace:*" }
            }
          ],
          (path) => !path.endsWith("/index.ts")
        )
      ).toEqual([]);
    } finally {
      Object.defineProperty(boundaries, "packages", { value: original });
    }
  });

  it("keeps provider production dependencies at context SPI entries", () => {
    for (const [name, rule] of Object.entries(boundaries.packages)) {
      if (rule.providerServices !== undefined) {
        for (const dependency of rule.dependsOn) {
          expect(dependency).toBe("@rivus/agent-kit-platform");
          expect(rule.typesOnly).toContain(dependency);
        }
        for (const dependency of rule.spiImports ?? []) {
          expect(boundaries.packages[dependency]?.spi, `${name} -> ${dependency}`).toBe(true);
          expect(boundaries.packages[dependency]?.providerServices).toBeUndefined();
        }
      } else {
        for (const dependency of [...rule.dependsOn, ...(rule.spiImports ?? [])]) {
          expect(boundaries.packages[dependency]?.providerServices, `${name} -> ${dependency}`).toBeUndefined();
        }
      }
    }
  });

  it("requires every provider to supply its marker list from facts", () => {
    for (const { name, folder } of projects) {
      const rule = boundaries.packages[name];
      if (rule?.providerServices !== undefined) {
        const path = `${folder}/src/facts.ts`;
        expect(rule.providerFacts, `facts path of ${name}`).toBe(path);
        expect(onDisk(path), `facts file of ${name}`).toBe(true);
        const facts = readFileSync(join(root, path), "utf8");
        expect(extractAgentMarkers(path, facts).length, `markers of ${name}`).toBeGreaterThan(0);
      }
    }
  });

  it("requires provider service exports and refuses a barrel", () => {
    const folder = "packages/providers/pi";
    expect(manifestViolations(packages, (path) => path !== `${folder}/src/hooks.ts` && onDisk(path))).toEqual([
      `${folder}: entry-file src/hooks.ts`
    ]);
    const probe = packages.map((pkg) =>
      pkg.folder === folder
        ? { ...pkg, exports: { ...pkg.exports, "./hooks": "./src/usage.ts", ".": "./src/index.ts" } }
        : pkg
    );
    expect(manifestViolations(probe, onDisk)).toEqual([
      `${folder}: entry-export ./hooks`,
      `${folder}: entry-export unexpected .`
    ]);
  });

  it("keep collab out of the shell's dependencies", () => {
    const withCollab = packages.map((pkg) =>
      pkg.name === "@rivus/agent-kit"
        ? { ...pkg, devDependencies: { ...pkg.devDependencies, "@rivus/agent-kit-collab": "workspace:*" } }
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

  it.each(
    packages.flatMap((pkg) =>
      (boundaries.packages[pkg.name]?.siblingEntries ?? []).map((entry) => ({ folder: pkg.folder, entry }))
    )
  )("requires $folder's declared sibling entry $entry in exports", ({ folder, entry }) => {
    const probe = packages.map((pkg) =>
      pkg.folder === folder
        ? {
            ...pkg,
            exports: Object.fromEntries(Object.entries(pkg.exports ?? {}).filter(([key]) => key !== `./${entry}`))
          }
        : pkg
    );
    expect(manifestViolations(probe, onDisk)).toEqual([`${folder}: entry-export ./${entry}`]);
  });

  it("forbids sibling and concept index files throughout package sources", () => {
    expect(
      globSync("packages/**/src/**/index.ts", { cwd: root, exclude: ["**/node_modules/**", "**/dist/**"] })
    ).toEqual([]);
  });

  it("rejects a restored sibling index file and root export", () => {
    const folder = "packages/sessions";
    expect(manifestViolations(packages, (path) => path === `${folder}/src/index.ts` || onDisk(path))).toEqual([
      `${folder}: entry-file forbidden src/index.ts`
    ]);
    const probe = packages.map((pkg) =>
      pkg.folder === folder ? { ...pkg, exports: { ...pkg.exports, ".": "./src/index.ts" } } : pkg
    );
    expect(manifestViolations(probe, onDisk)).toEqual([`${folder}: entry-export unexpected .`]);
  });

  it.each(["catalog", "discovery", "sessions", "harness", "acp"])("requires %s's SPI entry", (context) => {
    const folder = `packages/${context}`;
    expect(manifestViolations(packages, (path) => path !== `${folder}/src/spi.ts` && onDisk(path))).toEqual([
      `${folder}: entry-file src/spi.ts`
    ]);
    expect(
      manifestViolations(
        packages.map((pkg) =>
          pkg.folder === folder
            ? {
                ...pkg,
                exports: Object.fromEntries(Object.entries(pkg.exports ?? {}).filter(([entry]) => entry !== "./spi"))
              }
            : pkg
        ),
        onDisk
      )
    ).toEqual([`${folder}: entry-export ./spi`]);
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

  it.each(["boundaries/ignore", "boundaries/include", "import/ignore"])(
    "rejects the extra reserved setting %s",
    (key) => {
      const lint = withBoundaryLint(sharedLint, pathToFileURL(join(root, "packages/sessions/vite.config.ts")).href);
      expect(
        missingBoundaryRules({ ...lint, settings: { ...lint.settings, [key]: ["**/src/**"] } }, "packages/sessions")
      ).toEqual(["settings"]);
    }
  );

  it("rejects dropping the import plugin from the generated source override", () => {
    const lint = withBoundaryLint(sharedLint, pathToFileURL(join(root, "packages/sessions/vite.config.ts")).href);
    const probe: OxlintConfig = {
      ...lint,
      plugins: ["typescript"],
      overrides: lint.overrides?.map((override) =>
        override.plugins?.includes("import") ? { ...override, plugins: ["typescript"] } : override
      )
    };
    expect(missingBoundaryRules(probe, "packages/sessions")).toEqual(["overrides"]);
  });

  it("accepts unrelated settings and a narrower top-level plugin list", () => {
    const lint = withBoundaryLint(
      { ...sharedLint, plugins: ["typescript"], settings: { "react/version": "detect" } },
      pathToFileURL(join(root, "packages/sessions/vite.config.ts")).href
    );
    expect(missingBoundaryRules(lint, "packages/sessions")).toEqual([]);
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
