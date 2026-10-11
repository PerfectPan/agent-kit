import { readdirSync, readFileSync } from "node:fs";
import { isBuiltin } from "node:module";
import { dirname, join, relative } from "node:path";
import process from "node:process";
import { registerHooks } from "node:module";
import { fileURLToPath } from "node:url";

import { parseSync, Visitor } from "oxc-parser";

// Checks the built entries the way the shell's check-dist.ts does, with the rules of this package: it bundles only
// its own src/, reaches @rivus/agent-kit through that package's public entries (a peer, so one copy serves the
// process), imports no Node built-in, and only its Effect entries import the optional effect peer.
const EFFECT_ENTRIES = new Set(["./lanes", "./lease"]);
const EFFECT = /^(?:effect|@effect\/[^/]+)(?:\/|$)/;
const KIT = "@rivus/agent-kit";

interface Manifest {
  exports: Record<string, string | { types?: string; default?: string }>;
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
}

const packageRoot = fileURLToPath(new URL("..", import.meta.url));
const readManifest = (path: string) => JSON.parse(readFileSync(path, "utf8")) as Manifest;
const manifest = readManifest(join(packageRoot, "package.json"));
const kitEntries = new Set(
  Object.keys(readManifest(join(packageRoot, "node_modules", KIT, "package.json")).exports).map(
    (subpath) => `${KIT}${subpath.slice(1)}`
  )
);
const declared = new Set([
  ...Object.keys(manifest.dependencies ?? {}),
  ...Object.keys(manifest.peerDependencies ?? {})
]);
const show = (file: string) => relative(packageRoot, file);

function packageName(specifier: string): string {
  const [first = "", second = ""] = specifier.split("/");
  return first.startsWith("@") ? `${first}/${second}` : first;
}

function specifiers(file: string): string[] {
  const { module, program } = parseSync(file, readFileSync(file, "utf8"));
  const found = [
    ...module.staticImports.map((entry) => entry.moduleRequest.value),
    ...module.staticExports.flatMap((entry) => entry.entries.flatMap((item) => item.moduleRequest?.value ?? []))
  ];
  new Visitor({
    ImportExpression(node) {
      if (node.source.type === "Literal" && typeof node.source.value === "string") {
        found.push(node.source.value);
      }
    },
    TSImportType(node) {
      found.push(node.source.value);
    }
  }).visit(program);
  return found;
}

/** Bare specifiers reachable from a dist file through its relative imports, with the file that imports each. */
function externalImports(entryFile: string): Map<string, string> {
  const declarations = entryFile.endsWith(".d.ts");
  const external = new Map<string, string>();
  const seen = new Set<string>();
  const queue = [entryFile];
  for (let file = queue.pop(); file !== undefined; file = queue.pop()) {
    if (seen.has(file)) {
      continue;
    }
    seen.add(file);
    for (const specifier of specifiers(file)) {
      if (specifier.startsWith(".")) {
        const target = join(dirname(file), specifier);
        queue.push(declarations ? target.replace(/\.js$/, ".d.ts") : target);
      } else {
        external.set(specifier, file);
      }
    }
  }
  return external;
}

/** Dist-relative files reachable from a built file through relative imports, including itself. */
function reachableDistFiles(entryFile: string): Set<string> {
  const dist = join(packageRoot, "dist");
  const reached = new Set<string>();
  const queue = [entryFile];
  for (let file = queue.pop(); file !== undefined; file = queue.pop()) {
    if (reached.has(file)) {
      continue;
    }
    reached.add(file);
    for (const specifier of specifiers(file)) {
      if (specifier.startsWith(".")) {
        queue.push(join(dirname(file), specifier));
      }
    }
  }
  return new Set([...reached].map((file) => relative(dist, file)));
}

/**
 * The bundler opens every module it inlines with `//#region <source>`. Only this package's src/ may appear, plus
 * `zod/mini` in the files `/process-lock` loads: that entry bundles it, and `/lease` keeps importing it.
 */
function inlinedModules(): string[] {
  const problems: string[] = [];
  const dist = join(packageRoot, "dist");
  const zodInlineAllowed = reachableDistFiles(join(dist, "process-lock.js"));
  let regions = 0;
  for (const file of readdirSync(dist, { recursive: true, encoding: "utf8" })) {
    if (!/\.(?:d\.ts|js)$/.test(file)) {
      continue;
    }
    for (const [, source = ""] of readFileSync(join(dist, file), "utf8").matchAll(/^\/\/#region (.+)$/gm)) {
      regions += 1;
      if (source.startsWith("src/")) {
        continue;
      }
      if (zodInlineAllowed.has(file) && /\/node_modules\/zod\//.test(source)) {
        continue;
      }
      problems.push(`dist/${file} inlines ${source}; agent-kit, effect and other dependencies stay external`);
    }
  }
  return regions > 0 ? problems : ["dist has no //#region comments, so inlined modules cannot be detected"];
}

/** Specifiers of the `zod` package resolved while `load` runs. */
async function zodResolvedBy(load: () => Promise<void>): Promise<string[]> {
  const found: string[] = [];
  const hooks = registerHooks({
    resolve(specifier, context, next) {
      if (specifier === "zod" || specifier.startsWith("zod/")) {
        found.push(`${specifier} from ${context.parentURL ?? "the entry"}`);
      }
      return next(specifier, context);
    }
  });
  try {
    await load();
  } finally {
    hooks.deregister();
  }
  return found;
}

const errors: string[] = inlinedModules();
const checked: string[] = [];
for (const [subpath, target] of Object.entries(manifest.exports)) {
  if (subpath === "./package.json") {
    continue;
  }
  if (typeof target !== "object" || target.types === undefined || target.default === undefined) {
    errors.push(`${subpath}: export must name "types" and "default" files`);
    continue;
  }
  const effectEntry = EFFECT_ENTRIES.has(subpath);
  for (const file of [target.default, target.types]) {
    const imports = externalImports(join(packageRoot, file));
    if (effectEntry && ![...imports.keys()].some((specifier) => EFFECT.test(specifier))) {
      errors.push(`${subpath}: ${file} imports no effect module; effect must stay external instead of being inlined`);
    }
    for (const [specifier, importer] of imports) {
      const name = packageName(specifier);
      if (!effectEntry && EFFECT.test(specifier)) {
        errors.push(`${subpath}: ${show(importer)} imports ${specifier}, but this plain entry must not reach effect`);
      } else if (isBuiltin(specifier)) {
        errors.push(`${subpath}: ${show(importer)} imports Node built-in ${specifier}; only the platform does IO`);
      } else if (name === KIT && !kitEntries.has(specifier)) {
        errors.push(`${subpath}: ${show(importer)} imports ${specifier}, which is not a public entry of ${KIT}`);
      } else if (subpath === "./process-lock" && name === "zod") {
        errors.push(`${subpath}: ${show(importer)} imports ${specifier}; this entry bundles zod instead of loading it`);
      } else if (!declared.has(name)) {
        errors.push(`${subpath}: ${show(importer)} imports ${specifier}, which is not a dependency or peer`);
      }
    }
  }
  checked.push(`${subpath}${effectEntry ? " (effect)" : ""}`);
}

for (const hit of await zodResolvedBy(async () => {
  await import("@rivus/agent-kit/node");
  await import("@rivus/agent-kit-collab/process-lock");
})) {
  errors.push(`loading /node and /process-lock resolved ${hit}`);
}

if (errors.length > 0) {
  for (const error of errors) {
    console.error(`check-dist: ${error}`);
  }
  process.exit(1);
}
console.log(`check-dist: ok (${checked.join(", ")})`);
