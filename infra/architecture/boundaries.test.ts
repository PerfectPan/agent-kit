import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { type BoundaryRules, boundaries } from "./boundaries.ts";
import {
  checkBoundaries,
  type RuleId,
  type Violation,
  type Workspace,
  type WorkspacePackage
} from "./check-boundaries.ts";
import { loadWorkspace } from "./workspace.ts";

const real = loadWorkspace(fileURLToPath(new URL("../..", import.meta.url)));

const PLATFORM = "@rivus/agent-kit-platform";
const CATALOG = "@rivus/agent-kit-catalog";
const SESSIONS = "@rivus/agent-kit-sessions";
const TESTING = "@rivus/agent-kit-testing";

/** Planned packages that do not exist yet. */
const costPackage: WorkspacePackage = {
  name: "@rivus/agent-kit-cost",
  folder: "packages/cost",
  workspaceDependencies: []
};

/** The real workspace plus fixture packages and files. */
function withFiles(files: Record<string, string>, extraPackages: WorkspacePackage[] = []): Workspace {
  const entryFiles = extraPackages.flatMap((pkg) =>
    ["index.ts", "public.ts"].map((name) => ({ path: `${pkg.folder}/src/${name}`, source: "export {};\n" }))
  );
  return {
    packages: [...real.packages, ...extraPackages],
    files: [...real.files, ...entryFiles, ...Object.entries(files).map(([path, source]) => ({ path, source }))]
  };
}

const sessionsFile = (path: string, source: string) => withFiles({ [`packages/sessions/src/${path}`]: source });

const key = (violation: Violation) => `${violation.file} ${violation.rule} ${violation.message}`;
const realViolations = new Set(checkBoundaries(real, boundaries).map(key));

/** Rules broken by the fixture; violations already in the real tree are reported by the real-workspace test. */
function rulesOf(workspace: Workspace, rules: BoundaryRules = boundaries): RuleId[] {
  return checkBoundaries(workspace, rules)
    .filter((violation) => !realViolations.has(key(violation)))
    .map((violation) => violation.rule);
}

describe("the real workspace", () => {
  it("has the scaffold packages and source files", () => {
    expect(real.packages.map((pkg) => pkg.name)).toEqual(
      expect.arrayContaining([
        PLATFORM,
        CATALOG,
        SESSIONS,
        TESTING,
        "@rivus/agent-kit-platform-node",
        "@rivus/agent-kit"
      ])
    );
    expect(real.files.length).toBeGreaterThan(0);
  });

  it("matches the boundary manifest", () => {
    expect(checkBoundaries(real, boundaries)).toEqual([]);
  });
});

describe("allowed imports", () => {
  it.each([
    ["domain/session/head.ts", `import { ok } from "${CATALOG}";\nimport type { Result } from "${CATALOG}";`],
    ["domain/session/ref.ts", `import { head } from "./head.js";`],
    [
      "agents/codex/events.ts",
      `import { head } from "../../domain/session/head.js";\nimport { ok } from "${CATALOG}";`
    ],
    ["agents/grok/events.ts", `import { fromAcp } from "../../protocols/acp-updates.js";`],
    [
      "application/list-sessions.ts",
      `import { splitLines } from "${PLATFORM}";\nimport { x } from "../agents/index.js";`
    ],
    ["adapters/index-cache.ts", `import type { IndexCache } from "../application/ports.js";`],
    ["public.ts", `export { listSessions } from "./application/list-sessions.js";`]
  ])("sessions %s", (path, source) => {
    expect(rulesOf(sessionsFile(path, source))).toEqual([]);
  });

  it("lets the Node platform package import Node built-ins", () => {
    const workspace = withFiles({
      "packages/platform-node/src/fs.ts": `import { readFile } from "node:fs/promises";\nimport "${PLATFORM}";`
    });
    expect(rulesOf(workspace)).toEqual([]);
  });

  it("lets a package import an exact npm specifier from its allowlist outside domain/", () => {
    expect(rulesOf(sessionsFile("agents/codex/line.ts", `import * as z from "zod/mini";`))).toEqual([]);
    expect(rulesOf(sessionsFile("application/x.ts", `import { isPlainObject } from "es-toolkit";`))).toEqual([]);
    expect(rulesOf(sessionsFile("domain/usage/usage.ts", `import * as z from "zod/mini";`))).toEqual([
      "external-dependency"
    ]);
  });

  it("lets domain/ use import type from a declared upstream context, but not its values", () => {
    const rules: BoundaryRules = {
      ...boundaries,
      packages: { ...boundaries.packages, [costPackage.name]: { dependsOn: [SESSIONS], external: [] } }
    };
    const cost = (source: string) => withFiles({ "packages/cost/src/domain/pricing/price.ts": source }, [costPackage]);
    expect(rulesOf(cost(`import type { UsageRecord } from "${SESSIONS}";`), rules)).toEqual([]);
    expect(rulesOf(cost(`import { decodeUsage } from "${SESSIONS}";`), rules)).toEqual(["layer"]);
  });

  it("allows Effect only in the listed application/ and adapters/ paths", () => {
    const harness = (path: string) =>
      withFiles({ [`packages/harness/src/${path}`]: `import { Effect } from "effect";` });
    expect(rulesOf(harness("application/apply-install.ts"))).toEqual([]);
    expect(rulesOf(harness("adapters/ledger-store.ts"))).toEqual([]);
    expect(rulesOf(harness("domain/ledger/ledger.ts"))).toEqual(["effect"]);
    expect(rulesOf(harness("events.ts"))).toEqual(["effect"]);
  });

  it("lets Effect code import a sibling's Effect entry, such as the Platform service", () => {
    const service = `import { PlatformService } from "${PLATFORM}/effect";`;
    const layer = `${service}\nimport * as Layer from "effect/Layer";`;
    expect(rulesOf(withFiles({ "packages/platform-node/src/effect.ts": layer }))).toEqual([]);
    expect(rulesOf(withFiles({ "packages/harness/src/application/apply-install.ts": service }))).toEqual([]);
  });

  it("lets a shell entry re-export from a lighter public entry of an internal package", () => {
    const entry = (source: string) => withFiles({ "packages/agent-kit/src/extra.ts": source });
    expect(rulesOf(entry(`export { readHookEvent } from "@rivus/agent-kit-harness/public/events";`))).toEqual([]);
    expect(rulesOf(entry(`export { readHookEvent } from "@rivus/agent-kit-harness/events";`))).toEqual(["shell-entry"]);
  });
});

describe("violations", () => {
  it.each<[string, string, string, RuleId]>([
    ["node:* in a domain file", "domain/session/head.ts", `import { readFile } from "node:fs";`, "node-builtin"],
    ["a bare Node built-in in application/", "application/scan.ts", `import { join } from "path";`, "node-builtin"],
    [
      "Node types in a pure package",
      "agents/codex/x.ts",
      `import type { Readable } from "node:stream";`,
      "node-builtin"
    ],
    ["Effect in a pure package", "application/list.ts", `import { Effect } from "effect";`, "effect"],
    ["Effect types in a pure package", "domain/x.ts", `import type { Effect } from "effect/Effect";`, "effect"],
    [
      "a deep import into another package's domain/",
      "application/list.ts",
      `import { id } from "${CATALOG}/src/domain/coding-agent/index.js";`,
      "deep-import"
    ],
    [
      "a sibling importing a public entry",
      "application/list.ts",
      `import { ok } from "${CATALOG}/public";`,
      "deep-import"
    ],
    [
      "a relative import into another package",
      "application/list.ts",
      `import { id } from "../../../catalog/src/domain/coding-agent/index.js";`,
      "relative-escape"
    ],
    [
      "a value import from a non-kernel package in domain/",
      "domain/x.ts",
      `import { splitLines } from "${PLATFORM}";`,
      "layer"
    ],
    [
      "an inline type modifier in domain/, which still loads the module",
      "domain/x.ts",
      `import { type Platform } from "${PLATFORM}";`,
      "layer"
    ],
    [
      "agents/ importing application/",
      "agents/codex/x.ts",
      `import { list } from "../../application/list.js";`,
      "layer"
    ],
    [
      "agents/ importing a non-kernel package",
      "agents/codex/x.ts",
      `import type { Platform } from "${PLATFORM}";`,
      "layer"
    ],
    ["domain/ importing agents/", "domain/x.ts", `import { codex } from "../agents/codex/index.js";`, "layer"],
    ["domain/ importing the package root", "domain/x.ts", `import { x } from "../public.js";`, "layer"],
    ["an undeclared package dependency", "application/x.ts", `import { m } from "${TESTING}";`, "package-dependency"],
    [
      "an npm package outside the allowlist",
      "application/x.ts",
      `import { groupBy } from "lodash-es";`,
      "external-dependency"
    ],
    ["a computed dynamic import", "application/x.ts", "const m = await import(name);", "dynamic-import"],
    ["Platform types in domain/", "domain/x.ts", `import type { Platform } from "${PLATFORM}";`, "layer"],
    ["a Platform type re-export in domain/", "domain/x.ts", `export type { FileStat } from "${PLATFORM}";`, "layer"],
    [
      "zod's full entry where only zod/mini is allowed",
      "agents/codex/x.ts",
      `import { z } from "zod";`,
      "external-dependency"
    ],
    ["another zod subpath", "agents/codex/x.ts", `import * as z from "zod/v4/classic";`, "external-dependency"],
    [
      "es-toolkit's lodash-compatible layer",
      "application/x.ts",
      `import { get } from "es-toolkit/compat";`,
      "external-dependency"
    ]
  ])("rejects %s", (_name, path, source, rule) => {
    expect(rulesOf(sessionsFile(path, source))).toEqual([rule]);
  });

  it.each<[string, string, string, RuleId]>([
    [
      "Effect in the plain Platform port",
      "platform/src/platform.ts",
      `import type { Effect } from "effect/Effect";`,
      "effect"
    ],
    [
      "Effect in the plain Node platform",
      "platform-node/src/create-node-platform.ts",
      `import * as Layer from "effect/Layer";`,
      "effect"
    ],
    [
      "a sibling's Effect entry in a plain package",
      "sessions/src/application/x.ts",
      `import { PlatformService } from "${PLATFORM}/effect";`,
      "effect"
    ],
    [
      "a sibling's Effect entry in an Effect context's domain/",
      "harness/src/domain/lifecycle/x.ts",
      `import type { PlatformService } from "${PLATFORM}/effect";`,
      "effect"
    ],
    [
      "the shell's Effect entry of a sibling",
      "harness/src/application/x.ts",
      `import { PlatformService } from "${PLATFORM}/public/effect";`,
      "deep-import"
    ]
  ])("rejects %s", (_name, path, source, rule) => {
    expect(rulesOf(withFiles({ [`packages/${path}`]: source }))).toEqual([rule]);
  });

  it.each(["domain/bridge.d.ts", "domain/bridge.js", "application/x.mts"])("rejects %s under src/", (path) => {
    expect(rulesOf(sessionsFile(path, `export * from "../application/x.js";`))).toEqual(["source-file"]);
  });

  it("loads hand-written declaration files from disk, so a domain/ import through one is caught", () => {
    const root = mkdtempSync(join(tmpdir(), "boundaries-"));
    try {
      const files: Record<string, string> = {
        "rush.json": JSON.stringify({ projects: [{ packageName: SESSIONS, projectFolder: "packages/sessions" }] }),
        "packages/sessions/package.json": "{}",
        "packages/sessions/src/index.ts": "export {};",
        "packages/sessions/src/public.ts": "export {};",
        "packages/sessions/src/domain/a.ts": `import { x } from "./bridge.js";`,
        "packages/sessions/src/domain/bridge.d.ts": `export { x } from "../application/x.js";`,
        "packages/sessions/src/application/x.ts": "export const x = 1;"
      };
      for (const [path, source] of Object.entries(files)) {
        mkdirSync(dirname(join(root, path)), { recursive: true });
        writeFileSync(join(root, path), source);
      }
      expect(checkBoundaries(loadWorkspace(root), boundaries)).toEqual([
        expect.objectContaining({ file: "packages/sessions/src/domain/bridge.d.ts", rule: "source-file" })
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects a Rush project under packages/ that the manifest does not declare", () => {
    const stray: WorkspacePackage = {
      name: "@rivus/agent-kit-stray",
      folder: "packages/stray",
      workspaceDependencies: []
    };
    expect(rulesOf(withFiles({}, [stray]))).toEqual(["undeclared-package"]);
  });

  it("rejects a package.json workspace dependency the manifest does not allow", () => {
    const packages = real.packages.map((pkg) =>
      pkg.name === SESSIONS ? { ...pkg, workspaceDependencies: [...pkg.workspaceDependencies, TESTING] } : pkg
    );
    expect(rulesOf({ ...real, packages })).toEqual(["package-dependency"]);
  });

  it("requires index.ts and public.ts in every internal package", () => {
    const files = real.files.filter((file) => file.path !== "packages/sessions/src/public.ts");
    expect(rulesOf({ ...real, files })).toEqual(["entry-file"]);
  });

  it.each([
    ["export *", `export * from "${PLATFORM}/public";`],
    ["a re-export from index.ts", `export { splitLines } from "${PLATFORM}";`],
    ["a re-export from a non-workspace package", `export { z } from "zod/mini";`],
    ["local code", `import { splitLines } from "${PLATFORM}/public";\nexport const split = splitLines;`]
  ])("rejects %s in a shell entry", (_name, source) => {
    const rules = rulesOf(withFiles({ "packages/agent-kit/src/extra.ts": source }));
    expect(rules.length).toBeGreaterThan(0);
    expect(new Set(rules)).toEqual(new Set(["shell-entry"]));
  });
});
