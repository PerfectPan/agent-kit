/**
 * Lints the cases of `lint-cases.ts` and checks that each reports exactly the expected rule ids. The cases are written
 * into a temporary copy of the repository whose `node_modules` folders link to the real ones, so a run never writes
 * into the working tree; the copy is removed when the run ends or is interrupted. Run with `node run-lint-cases.ts`
 * (this package's `test` script does); it exits non-zero when a case fails.
 */
import { execFile, execFileSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from "node:fs";
import { constants, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { cases } from "./lint-cases.ts";
import type { Case } from "./case.ts";
import { workspaceProjects } from "./lint.ts";

const ROOT = realpathSync(fileURLToPath(new URL("../..", import.meta.url)));
const run = promisify(execFile);

interface Diagnostic {
  readonly message: string;
  readonly code?: string;
  readonly filename: string;
  readonly labels?: readonly { readonly span: { readonly line: number; readonly column: number } }[];
}

/** The rule id of a diagnostic, or undefined for a type-check diagnostic of the fixture code itself. */
function ruleOf({ code = "", message }: Diagnostic): string | undefined {
  const tagged = /^\[([a-z-]+)\]/.exec(message)?.[1];
  if (tagged !== undefined) {
    return tagged;
  }
  if (code === "import(no-nodejs-modules)") {
    return "node-builtin";
  }
  if (code === "boundaries(no-unknown-files)") {
    return "undeclared-package";
  }
  // Fixtures re-export names that clash or do not exist; the type check reports them, and they are not boundary rules.
  if (code.startsWith("typescript(")) {
    return undefined;
  }
  return code === "" ? "parse" : `other:${code}`;
}

function lineOf(diagnostic: Diagnostic): string {
  const span = diagnostic.labels?.[0]?.span;
  return `${diagnostic.filename}:${span?.line ?? 0}:${span?.column ?? 0}: ${diagnostic.code ?? ""}: ${diagnostic.message}`;
}

/** `vp lint` in one package of the copy, as `pnpm -r run lint` runs it there. */
async function lint(copy: string, folder: string, files: readonly string[]): Promise<Diagnostic[]> {
  const cwd = join(copy, folder);
  const args = ["lint", "--format", "json", ...files];
  const options = { cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 } as const;
  // vp exits non-zero when it reports errors; the JSON on stdout is the result either way.
  const { stdout } = await run(join(cwd, "node_modules/.bin/vp"), args, options).catch(
    (error: { stdout?: string; stderr?: string }) => {
      if (error.stdout === undefined || !error.stdout.includes("{")) {
        throw new Error(`vp lint failed in ${folder}: ${error.stderr ?? ""}`, { cause: error });
      }
      return { stdout: error.stdout };
    }
  );
  return (JSON.parse(stdout.slice(stdout.indexOf("{"))) as { diagnostics: Diagnostic[] }).diagnostics;
}

/** Copies the tracked and the untracked, not ignored, files and links each project's `node_modules` to the real one. */
function copyRepository(copy: string): void {
  const listed = execFileSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024
  });
  for (const path of listed.split("\0").filter((entry) => entry !== "" && existsSync(join(ROOT, entry)))) {
    cpSync(join(ROOT, path), join(copy, path));
  }
  for (const folder of [".", ...workspaceProjects(ROOT).map((project) => project.folder)]) {
    if (existsSync(join(ROOT, folder, "node_modules"))) {
      symlinkSync(join(ROOT, folder, "node_modules"), join(copy, folder, "node_modules"));
    }
  }
}

/** A synthetic peer provider exists only in the fixture copy for SPI and inter-provider boundary cases. */
function spiProvider(copy: string, slim = false): void {
  const id = slim ? "slim-probe" : "spi-probe";
  const folder = join(copy, "packages/providers", id);
  const name = `@rivus/agent-kit-provider-${id}`;
  const contexts = ["catalog", "discovery", "sessions", "harness", "acp"].map(
    (context) => `@rivus/agent-kit-${context}`
  );
  const dependsOn = [...contexts, "@rivus/agent-kit-platform"];
  mkdirSync(join(folder, "src"), { recursive: true });
  writeFileSync(
    join(folder, "package.json"),
    JSON.stringify({
      name,
      type: "module",
      dependencies: Object.fromEntries(dependsOn.map((dep) => [dep, "workspace:*"]))
    })
  );
  writeFileSync(join(folder, "src/identity.ts"), "export const probeIdentity = true;\n");
  cpSync(join(copy, "packages/catalog/tsconfig.json"), join(folder, "tsconfig.json"));
  writeFileSync(
    join(folder, "vite.config.ts"),
    readFileSync(join(copy, "packages/catalog/vite.config.ts"), "utf8").replace("../../infra/", "../../../infra/")
  );
  symlinkSync(join(ROOT, "packages/agent-kit/node_modules"), join(folder, "node_modules"));
  const manifest = join(copy, "infra/architecture/boundaries.ts");
  const rule = {
    dependsOn: ["@rivus/agent-kit-platform"],
    spiImports: [...contexts, "@rivus/agent-kit-platform"].filter(
      (context) => !slim || context !== "@rivus/agent-kit-harness"
    ),
    ...(slim ? { providerServices: ["hooks", "usage"] } : {}),
    typesOnly: ["@rivus/agent-kit-acp"],
    external: []
  };
  writeFileSync(
    manifest,
    readFileSync(manifest, "utf8").replace("  packages: {", `  packages: {\n    "${name}": ${JSON.stringify(rule)},`)
  );
}

/** Writes a case into the copy and returns how to take it out again. */
function apply(copy: string, entry: Case): () => void {
  const file = join(copy, "packages", entry.pkg, entry.path);
  if (existsSync(file)) {
    const original = readFileSync(file, "utf8");
    writeFileSync(file, `${original}\n${entry.source}\n`);
    return () => writeFileSync(file, original);
  }
  const created = mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${entry.source}\n`);
  return () => rmSync(created ?? file, { recursive: true, force: true });
}

/** One batch per package; a file edited by two cases goes to separate batches. */
function batches(): Case[][] {
  const result: Case[][] = [];
  for (const entry of cases) {
    const batch = result.find(
      (candidate) => candidate[0]?.pkg === entry.pkg && !candidate.some((other) => other.path === entry.path)
    );
    if (batch === undefined) {
      result.push([entry]);
    } else {
      batch.push(entry);
    }
  }
  return result;
}

/** Results of a package directory that `boundaries.ts` does not declare, set up like a copy of catalog. */
async function strayPackage(copy: string): Promise<Diagnostic[]> {
  const folder = join(copy, "packages/stray");
  mkdirSync(join(folder, "src"), { recursive: true });
  writeFileSync(join(folder, "package.json"), JSON.stringify({ name: "@rivus/agent-kit-stray", type: "module" }));
  for (const file of ["tsconfig.json", "vite.config.ts"]) {
    cpSync(join(copy, "packages/catalog", file), join(folder, file));
  }
  writeFileSync(join(folder, "src/index.ts"), "export const stray = 1;\n");
  symlinkSync(join(ROOT, "packages/catalog/node_modules"), join(folder, "node_modules"));
  return lint(copy, "packages/stray", ["src/index.ts"]);
}

/** Move a declared package into the provider workspace glob, without adding a fake package to the manifest. */
async function nestedProvider(copy: string): Promise<Diagnostic[]> {
  const folder = "packages/providers/probe";
  mkdirSync(join(copy, "packages/providers"), { recursive: true });
  renameSync(join(copy, "packages/catalog"), join(copy, folder));
  const config = join(copy, folder, "vite.config.ts");
  writeFileSync(config, readFileSync(config, "utf8").replace("../../infra/", "../../../infra/"));
  writeFileSync(join(copy, folder, "src/effect.ts"), "export const providerEffect = 1;\n");
  writeFileSync(join(copy, folder, "src/plain.ts"), 'export { providerEffect } from "./effect.js";\n');
  writeFileSync(join(copy, folder, "src/allowed.ts"), 'export { ok } from "./index.js";\n');
  return lint(copy, folder, ["src/plain.ts", "src/allowed.ts"]);
}

/** The generated override must enable the Node boundary rule even when the top-level plugins list omits import. */
async function restrictedPlugins(copy: string): Promise<Diagnostic[]> {
  const folder = "packages/sessions";
  const config = join(copy, folder, "vite.config.ts");
  const original = readFileSync(config, "utf8");
  const restricted = original.replace(
    "withBoundaryLint(lint, import.meta.url)",
    '{ ...withBoundaryLint(lint, import.meta.url), plugins: ["typescript"] }'
  );
  if (restricted === original) {
    throw new Error("The plugin fixture could not replace sessions' top-level plugins");
  }
  writeFileSync(config, restricted);
  writeFileSync(join(copy, folder, "src/plugin-node.ts"), 'export { readFile } from "node:fs/promises";\n');
  writeFileSync(join(copy, folder, "src/plugin-plain.ts"), 'export { ok } from "@rivus/agent-kit-catalog";\n');
  try {
    return await lint(copy, folder, ["src/plugin-node.ts", "src/plugin-plain.ts"]);
  } finally {
    writeFileSync(config, original);
  }
}

/** A new provider fact must reach the context rule without updating infrastructure's marker list. */
async function addedProviderMarker(copy: string): Promise<Diagnostic[]> {
  const facts = join(copy, "packages/providers/pi/src/facts.ts");
  const original = readFileSync(facts, "utf8");
  const marker = "PROVIDER_MARKER_PROBE";
  writeFileSync(
    facts,
    original.replace(
      "export const agentMarkers: readonly string[] = [",
      `export const agentMarkers: readonly string[] = ["${marker}",`
    )
  );
  const file = join(copy, "packages/catalog/src/marker-probe.ts");
  writeFileSync(file, `export const marker = "${marker}";\n`);
  try {
    return await lint(copy, "packages/catalog", ["src/marker-probe.ts"]);
  } finally {
    writeFileSync(facts, original);
    rmSync(file);
  }
}

function report(name: string, path: string, expected: readonly string[], diagnostics: Diagnostic[]): boolean {
  const reported = diagnostics.flatMap((diagnostic) => {
    const rule = ruleOf(diagnostic);
    return rule === undefined ? [] : [{ rule, line: lineOf(diagnostic) }];
  });
  const rules = [...new Set(reported.map(({ rule }) => rule))].toSorted();
  const pass = rules.join(",") === [...expected].toSorted().join(",");
  console.log(
    `${pass ? "PASS" : "FAIL"} | ${name} | ${path} | expected [${expected.join(",")}] got [${rules.join(",")}] | ${reported[0]?.line ?? ""}`
  );
  if (!pass) {
    console.log(diagnostics.map(lineOf).join("\n"));
  }
  return pass;
}

const copy = realpathSync(mkdtempSync(join(tmpdir(), "boundary-cases-")));
const removeCopy = (): void => rmSync(copy, { recursive: true, force: true });
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
  process.once(signal, () => {
    removeCopy();
    process.exit(128 + constants.signals[signal]);
  });
}

const started = performance.now();
let failures = 0;
try {
  copyRepository(copy);
  // Context adapter targets must resolve even after the last agent implementation moves out.
  const adapters = join(copy, "packages/sessions/src/domain/session/adapters/probe");
  mkdirSync(adapters, { recursive: true });
  for (const name of ["layout", "preview"]) {
    writeFileSync(join(adapters, `${name}.ts`), "export const probe = true;\n");
  }
  spiProvider(copy);
  spiProvider(copy, true);
  for (const batch of batches()) {
    const undo = batch.map((entry) => apply(copy, entry));
    try {
      const pkg = batch[0]?.pkg ?? "";
      const diagnostics = await lint(
        copy,
        `packages/${pkg}`,
        batch.map(({ path }) => path)
      );
      for (const entry of batch) {
        const own = diagnostics.filter(({ filename }) => filename === entry.path);
        failures += report(entry.name, `packages/${pkg}/${entry.path}`, entry.expected, own) ? 0 : 1;
      }
    } finally {
      for (const restore of undo.toReversed()) {
        restore();
      }
    }
  }
  failures += report(
    "agent marker: added provider fact",
    "packages/catalog/src/marker-probe.ts",
    ["agent-marker"],
    await addedProviderMarker(copy)
  )
    ? 0
    : 1;
  const restricted = await restrictedPlugins(copy);
  failures += report(
    "typescript-only top-level plugins: Node builtin",
    "packages/sessions/src/plugin-node.ts",
    ["node-builtin"],
    restricted.filter(({ filename }) => filename === "src/plugin-node.ts")
  )
    ? 0
    : 1;
  failures += report(
    "typescript-only top-level plugins: allowed import",
    "packages/sessions/src/plugin-plain.ts",
    [],
    restricted.filter(({ filename }) => filename === "src/plugin-plain.ts")
  )
    ? 0
    : 1;
  const stray = await strayPackage(copy);
  failures += report("an undeclared package directory", "packages/stray/src/index.ts", ["undeclared-package"], stray)
    ? 0
    : 1;
  const provider = await nestedProvider(copy);
  failures += report(
    "provider plain entry: local Effect entry",
    "packages/providers/probe/src/plain.ts",
    ["effect"],
    provider.filter(({ filename }) => filename === "src/plain.ts")
  )
    ? 0
    : 1;
  failures += report(
    "provider plain entry: local plain entry",
    "packages/providers/probe/src/allowed.ts",
    [],
    provider.filter(({ filename }) => filename === "src/allowed.ts")
  )
    ? 0
    : 1;
} finally {
  removeCopy();
}

const seconds = ((performance.now() - started) / 1000).toFixed(1);
console.log(`${cases.length + 6} cases, ${failures} failed, ${seconds} s`);
process.exitCode = failures === 0 ? 0 : 1;
