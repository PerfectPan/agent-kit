import { isBuiltin } from "node:module";
import { join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { rolldown } from "rolldown";

import {
  checkManifestExports,
  declaredPackages,
  EFFECT_SPECIFIER,
  packageName,
  reachableDistFiles,
  readDistManifest,
  reportCheckDist,
  scanInlinedSources,
  zodResolvedBy
} from "./check-dist-lib.ts";

// Entries that only run on Node; every other entry must bundle for a browser without Node built-ins.
const NODE_ONLY_ENTRIES = new Set(["./node", "./node/effect", "./testing"]);
// Entries whose code and declarations import nothing outside the package, not even its dependencies: a host that
// cannot install dependencies bundles or loads them on their own.
const ZERO_DEPENDENCY_ENTRIES = new Set(["./cost", "./cost/prices", "./harness/events", "./transcript/usage"]);
// These entries bundle zod/mini instead of importing it. `/node` and `/node/effect` share the platform chunk, so the
// files reachable from either may inline zod; every other entry keeps the import.
const ZOD_BUNDLE_ENTRIES = new Set([...ZERO_DEPENDENCY_ENTRIES, "./node", "./node/effect"]);
// Entries that import the optional `effect` peer, which must stay an external import. Every other entry is plain:
// neither its code nor its declarations may reach `effect`, so a consumer without Effect can load and type-check it.
const EFFECT_ENTRIES = new Set(["./acp", "./harness", "./node/effect", "./platform/effect", "./testing/effect"]);
// Dependencies that the code may import but no declaration file may: the ACP SDK is internal to `/acp`, and its types
// are not part of the published API.
const INTERNAL_DEPENDENCIES = new Set(["@agentclientprotocol/sdk"]);

const packageRoot = fileURLToPath(new URL("..", import.meta.url));
const manifest = readDistManifest(join(packageRoot, "package.json"));
const declared = declaredPackages(manifest);
const show = (file: string) => relative(packageRoot, file);

function inlinedDependencies(): string[] {
  const zodBundleAllowed = new Set<string>();
  for (const [subpath, target] of Object.entries(manifest.exports)) {
    if (subpath === "./package.json" || typeof target === "string" || !ZOD_BUNDLE_ENTRIES.has(subpath)) {
      continue;
    }
    for (const file of [target.default, target.types]) {
      if (typeof file === "string") {
        for (const reached of reachableDistFiles(packageRoot, join(packageRoot, file))) {
          zodBundleAllowed.add(reached);
        }
      }
    }
  }
  return scanInlinedSources(
    packageRoot,
    (file, source) => {
      if (!source.includes("node_modules/")) {
        return undefined;
      }
      if (zodBundleAllowed.has(file) && /\/node_modules\/zod\//.test(source)) {
        return undefined;
      }
      return `dist/${file} inlines ${source}; dependencies and peers such as effect stay external`;
    },
    "dist has no source comments, so inlined dependencies cannot be detected"
  );
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
await checkManifestExports(packageRoot, manifest, EFFECT_ENTRIES, errors, async (entry, file, imports) => {
  const { subpath, effectEntry } = entry;
  const browserSafe = !NODE_ONLY_ENTRIES.has(subpath);
  const zeroDependency = ZERO_DEPENDENCY_ENTRIES.has(subpath);
  for (const [specifier, importer] of imports) {
    if (zeroDependency) {
      errors.push(`${subpath}: ${show(importer)} imports ${specifier}, but this entry must import nothing`);
    } else if (!effectEntry && EFFECT_SPECIFIER.test(specifier)) {
      errors.push(`${subpath}: ${show(importer)} imports ${specifier}, but this plain entry must not reach effect`);
    } else if (isBuiltin(specifier)) {
      if (browserSafe) {
        errors.push(`${subpath}: ${show(importer)} imports Node built-in ${specifier}`);
      }
    } else if (ZOD_BUNDLE_ENTRIES.has(subpath) && packageName(specifier) === "zod") {
      errors.push(`${subpath}: ${show(importer)} imports ${specifier}; this entry bundles zod instead of loading it`);
    } else if (!declared.has(packageName(specifier))) {
      errors.push(`${subpath}: ${show(importer)} imports ${specifier}, which is not a dependency or peer`);
    } else if (file === entry.types && INTERNAL_DEPENDENCIES.has(packageName(specifier))) {
      errors.push(`${subpath}: ${show(importer)} imports ${specifier}, whose types must stay out of the declarations`);
    }
  }
  if (file === entry.types) {
    if (browserSafe) {
      for (const problem of await browserBundleProblems(join(packageRoot, entry.default))) {
        errors.push(`${subpath}: browser bundle ${problem}`);
      }
    }
    checked.push(
      `${subpath}${browserSafe ? " (browser)" : ""}${zeroDependency ? " (no imports)" : ""}${effectEntry ? " (effect)" : ""}`
    );
  }
});

for (const hit of await zodResolvedBy(() => import(pathToFileURL(join(packageRoot, "dist/node.js")).href))) {
  errors.push(`loading /node resolved ${hit}`);
}

reportCheckDist(errors, checked);
