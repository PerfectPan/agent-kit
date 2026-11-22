import { isBuiltin } from "node:module";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

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
} from "../../agent-kit/scripts/check-dist-lib.ts";

// Checks the built entries the way the shell's check-dist.ts does, with the rules of this package: it bundles only
// its own src/, reaches @rivus/agent-kit through that package's public entries (a peer, so one copy serves the
// process), imports no Node built-in, and only its Effect entries import the optional effect peer.
const EFFECT_ENTRIES = new Set(["./lanes", "./lease"]);
const KIT = "@rivus/agent-kit";

const packageRoot = fileURLToPath(new URL("..", import.meta.url));
const manifest = readDistManifest(join(packageRoot, "package.json"));
const kitEntries = new Set(
  Object.keys(readDistManifest(join(packageRoot, "node_modules", KIT, "package.json")).exports).map(
    (subpath) => `${KIT}${subpath.slice(1)}`
  )
);
const declared = declaredPackages(manifest);
const show = (file: string) => relative(packageRoot, file);

const zodInlineAllowed = reachableDistFiles(packageRoot, join(packageRoot, "dist", "process-lock.js"));
const errors: string[] = scanInlinedSources(
  packageRoot,
  (file, source) => {
    if (source.startsWith("src/")) {
      return undefined;
    }
    if (zodInlineAllowed.has(file) && /\/node_modules\/zod\//.test(source)) {
      return undefined;
    }
    return `dist/${file} inlines ${source}; agent-kit, effect and other dependencies stay external`;
  },
  "dist has no source comments, so inlined modules cannot be detected"
);

const checked: string[] = [];
await checkManifestExports(packageRoot, manifest, EFFECT_ENTRIES, errors, (entry, file, imports) => {
  const { subpath, effectEntry } = entry;
  for (const [specifier, importer] of imports) {
    const name = packageName(specifier);
    if (!effectEntry && EFFECT_SPECIFIER.test(specifier)) {
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
  if (file === entry.types) {
    checked.push(`${subpath}${effectEntry ? " (effect)" : ""}`);
  }
});

for (const hit of await zodResolvedBy(async () => {
  await import("@rivus/agent-kit/node");
  await import("@rivus/agent-kit-collab/process-lock");
})) {
  errors.push(`loading /node and /process-lock resolved ${hit}`);
}

reportCheckDist(errors, checked);
