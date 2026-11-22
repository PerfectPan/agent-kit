import { readdirSync, readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { dirname, join, relative } from "node:path";
import process from "node:process";

import { parseSync, Visitor } from "oxc-parser";
import * as z from "zod/mini";

export const EFFECT_SPECIFIER: RegExp = /^(?:effect|@effect\/[^/]+)(?:\/|$)/;

const Manifest = z.object({
  exports: z.record(
    z.string(),
    z.union([z.string(), z.object({ types: z.optional(z.string()), default: z.optional(z.string()) })])
  ),
  dependencies: z.optional(z.record(z.string(), z.string())),
  peerDependencies: z.optional(z.record(z.string(), z.string()))
});

export type DistManifest = z.infer<typeof Manifest>;

export function readDistManifest(path: string): DistManifest {
  return Manifest.parse(JSON.parse(readFileSync(path, "utf8")));
}

export function declaredPackages(manifest: DistManifest): Set<string> {
  return new Set([...Object.keys(manifest.dependencies ?? {}), ...Object.keys(manifest.peerDependencies ?? {})]);
}

export function packageName(specifier: string): string {
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
export function reachableDistFiles(packageRoot: string, entryFile: string): Set<string> {
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
 * Scans `dist/` for test artifacts and bundler source comments (`// <source>` or `//#region <source>`).
 * `checkSource` returns a problem message for any disallowed inlined source, or `undefined` when allowed.
 */
export function scanInlinedSources(
  packageRoot: string,
  checkSource: (file: string, source: string) => string | undefined,
  noCommentsMessage: string
): string[] {
  const problems: string[] = [];
  let regions = 0;
  const dist = join(packageRoot, "dist");
  for (const file of readdirSync(dist, { recursive: true, encoding: "utf8" })) {
    if (/(?:^|\/)test(?:\/|$)|\.(?:test|spec)\./.test(file)) {
      problems.push(`dist/${file} is a test artifact; published packages must exclude tests`);
    }
    if (!/\.(?:d\.ts|js)$/.test(file)) {
      continue;
    }
    for (const [, source = ""] of readFileSync(join(dist, file), "utf8").matchAll(
      /^\/\/(?:#region | )((?:src\/|\.\.?\/|node_modules\/).+)$/gm
    )) {
      regions += 1;
      if (/(?:^|\/)test(?:\/|$)|\.(?:test|spec)\./.test(source)) {
        problems.push(`dist/${file} inlines test source ${source}`);
      }
      const problem = checkSource(file, source);
      if (problem !== undefined) {
        problems.push(problem);
      }
    }
  }
  return regions > 0 ? problems : [noCommentsMessage];
}

/** Specifiers of the `zod` package resolved while `load` runs. */
export async function zodResolvedBy(load: () => Promise<void>): Promise<string[]> {
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

export function reportCheckDist(errors: readonly string[], checked: readonly string[]): void {
  if (errors.length > 0) {
    for (const error of errors) {
      console.error(`check-dist: ${error}`);
    }
    process.exit(1);
  }
  console.log(`check-dist: ok (${checked.join(", ")})`);
}

export interface ExportTarget {
  readonly subpath: string;
  readonly default: string;
  readonly types: string;
  readonly effectEntry: boolean;
}

/** Iterates manifest exports, checks `default`/`types` presence and effect-entry imports, and invokes `check`. */
export function checkManifestExports(
  packageRoot: string,
  manifest: DistManifest,
  effectEntries: ReadonlySet<string>,
  errors: string[],
  check: (target: ExportTarget, file: string, imports: Map<string, string>) => void | Promise<void>
): Promise<void> {
  return (async () => {
    for (const [subpath, target] of Object.entries(manifest.exports)) {
      if (subpath === "./package.json") {
        continue;
      }
      if (typeof target === "string" || target.types === undefined || target.default === undefined) {
        errors.push(`${subpath}: export must name "types" and "default" files`);
        continue;
      }
      const effectEntry = effectEntries.has(subpath);
      const entry: ExportTarget = { subpath, default: target.default, types: target.types, effectEntry };
      for (const file of [target.default, target.types]) {
        const imports = externalImports(join(packageRoot, file));
        if (effectEntry && ![...imports.keys()].some((specifier) => EFFECT_SPECIFIER.test(specifier))) {
          errors.push(
            `${subpath}: ${file} imports no effect module; effect must stay external instead of being inlined`
          );
        }
        await check(entry, file, imports);
      }
    }
  })();
}
