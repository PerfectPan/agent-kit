import { readdirSync, readFileSync } from "node:fs";
import { isBuiltin } from "node:module";
import { dirname, join, relative } from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

import { registerHooks } from "node:module";

import { parseSync, Visitor } from "oxc-parser";
import { rolldown } from "rolldown";

// Entries that only run on Node; every other entry must bundle for a browser without Node built-ins.
const NODE_ONLY_ENTRIES = new Set(["./node", "./node/effect", "./testing"]);
// Entries whose code and declarations import nothing outside the package, not even its dependencies: a host that
// cannot install dependencies bundles or loads them on their own.
const ZERO_DEPENDENCY_ENTRIES = new Set(["./cost", "./harness/events", "./transcript/usage"]);
// These entries bundle zod/mini instead of importing it. `/node` and `/node/effect` share the platform chunk, so the
// files reachable from either may inline zod; every other entry keeps the import.
const ZOD_BUNDLE_ENTRIES = new Set([...ZERO_DEPENDENCY_ENTRIES, "./node", "./node/effect"]);
// Entries that import the optional `effect` peer, which must stay an external import. Every other entry is plain:
// neither its code nor its declarations may reach `effect`, so a consumer without Effect can load and type-check it.
const EFFECT_ENTRIES = new Set(["./acp", "./harness", "./node/effect", "./platform/effect", "./testing/effect"]);
// Dependencies that the code may import but no declaration file may: the ACP SDK is internal to `/acp`, and its types
// are not part of the published API.
const INTERNAL_DEPENDENCIES = new Set(["@agentclientprotocol/sdk"]);
const EFFECT = /^(?:effect|@effect\/[^/]+)(?:\/|$)/;

interface Manifest {
  exports: Record<string, string | { types?: string; default?: string }>;
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
}

const packageRoot = fileURLToPath(new URL("..", import.meta.url));
const manifest = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8")) as Manifest;
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
  const declarations = entryFile.endsWith(".d.ts");
  const reached = new Set<string>();
  const queue = [entryFile];
  for (let file = queue.pop(); file !== undefined; file = queue.pop()) {
    if (reached.has(file)) {
      continue;
    }
    reached.add(file);
    for (const specifier of specifiers(file)) {
      if (!specifier.startsWith(".")) {
        continue;
      }
      const target = join(dirname(file), specifier);
      queue.push(declarations ? target.replace(/\.js$/, ".d.ts") : target);
    }
  }
  return new Set([...reached].map((file) => relative(dist, file)));
}

/**
 * Bundled modules that come from `node_modules`. The bundler opens every module it inlines with a `//#region <source>`
 * comment, in code and declarations alike; internal packages are workspace links resolved to their own folders. The
 * zero-dependency entries and the Node platform chunk bundle `zod/mini` instead of importing it. No other dist file
 * may inline a dependency, so the other built entries keep importing `zod/mini` and the optional `effect` peer stays
 * external.
 */
function inlinedDependencies(): string[] {
  const problems: string[] = [];
  const zodBundleAllowed = new Set<string>();
  for (const [subpath, target] of Object.entries(manifest.exports)) {
    if (subpath === "./package.json" || typeof target !== "object" || !ZOD_BUNDLE_ENTRIES.has(subpath)) {
      continue;
    }
    for (const file of [target.default, target.types]) {
      if (typeof file === "string") {
        for (const reached of reachableDistFiles(join(packageRoot, file))) {
          zodBundleAllowed.add(reached);
        }
      }
    }
  }
  let regions = 0;
  const dist = join(packageRoot, "dist");
  for (const file of readdirSync(dist, { recursive: true, encoding: "utf8" })) {
    if (!/\.(?:d\.ts|js)$/.test(file)) {
      continue;
    }
    for (const [, source = ""] of readFileSync(join(dist, file), "utf8").matchAll(/^\/\/#region (.+)$/gm)) {
      regions += 1;
      if (!source.includes("node_modules/")) {
        continue;
      }
      if (zodBundleAllowed.has(file) && /\/node_modules\/zod\//.test(source)) {
        continue;
      }
      problems.push(`dist/${file} inlines ${source}; dependencies and peers such as effect stay external`);
    }
  }
  return regions > 0 ? problems : ["dist has no //#region comments, so inlined dependencies cannot be detected"];
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

async function browserBundleProblems(entryFile: string): Promise<string[]> {
  const problems: string[] = [];
  const bundle = await rolldown({
    input: entryFile,
    platform: "browser",
    onLog(level, log) {
      if (level === "warn" && log.code === "UNRESOLVED_IMPORT") {
        problems.push(log.message);
      }
    },
    plugins: [
      {
        name: "report-node-builtins",
        resolveId(source, importer) {
          if (!isBuiltin(source)) {
            return null;
          }
          problems.push(
            `pulls in Node built-in ${source} from ${importer === undefined ? "the entry" : show(importer)}`
          );
          return { id: source, external: true };
        }
      }
    ]
  });
  await bundle.generate({ format: "esm" });
  await bundle.close();
  return problems;
}

const errors: string[] = inlinedDependencies();
const checked: string[] = [];
for (const [subpath, target] of Object.entries(manifest.exports)) {
  if (subpath === "./package.json") {
    continue;
  }
  if (typeof target !== "object" || target.types === undefined || target.default === undefined) {
    errors.push(`${subpath}: export must name "types" and "default" files`);
    continue;
  }
  const browserSafe = !NODE_ONLY_ENTRIES.has(subpath);
  const zeroDependency = ZERO_DEPENDENCY_ENTRIES.has(subpath);
  const effectEntry = EFFECT_ENTRIES.has(subpath);
  for (const file of [target.default, target.types]) {
    const imports = externalImports(join(packageRoot, file));
    if (effectEntry && ![...imports.keys()].some((specifier) => EFFECT.test(specifier))) {
      errors.push(`${subpath}: ${file} imports no effect module; effect must stay external instead of being inlined`);
    }
    for (const [specifier, importer] of imports) {
      if (zeroDependency) {
        errors.push(`${subpath}: ${show(importer)} imports ${specifier}, but this entry must import nothing`);
      } else if (!effectEntry && EFFECT.test(specifier)) {
        errors.push(`${subpath}: ${show(importer)} imports ${specifier}, but this plain entry must not reach effect`);
      } else if (isBuiltin(specifier)) {
        if (browserSafe) {
          errors.push(`${subpath}: ${show(importer)} imports Node built-in ${specifier}`);
        }
      } else if (ZOD_BUNDLE_ENTRIES.has(subpath) && packageName(specifier) === "zod") {
        errors.push(`${subpath}: ${show(importer)} imports ${specifier}; this entry bundles zod instead of loading it`);
      } else if (!declared.has(packageName(specifier))) {
        errors.push(`${subpath}: ${show(importer)} imports ${specifier}, which is not a dependency or peer`);
      } else if (file === target.types && INTERNAL_DEPENDENCIES.has(packageName(specifier))) {
        errors.push(
          `${subpath}: ${show(importer)} imports ${specifier}, whose types must stay out of the declarations`
        );
      }
    }
  }
  if (browserSafe) {
    for (const problem of await browserBundleProblems(join(packageRoot, target.default))) {
      errors.push(`${subpath}: browser bundle ${problem}`);
    }
  }
  checked.push(
    `${subpath}${browserSafe ? " (browser)" : ""}${zeroDependency ? " (no imports)" : ""}${effectEntry ? " (effect)" : ""}`
  );
}

for (const hit of await zodResolvedBy(() => import(pathToFileURL(join(packageRoot, "dist/node.js")).href))) {
  errors.push(`loading /node resolved ${hit}`);
}

if (errors.length > 0) {
  for (const error of errors) {
    console.error(`check-dist: ${error}`);
  }
  process.exit(1);
}
console.log(`check-dist: ok (${checked.join(", ")})`);
