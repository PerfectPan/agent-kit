import { readFileSync } from "node:fs";
import { isBuiltin } from "node:module";
import { dirname, join, relative } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { parseSync, Visitor } from "oxc-parser";
import { rolldown } from "rolldown";

// Entries that only run on Node; every other entry must bundle for a browser without Node built-ins.
const NODE_ONLY_ENTRIES = new Set(["./node", "./testing"]);

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

const errors: string[] = [];
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
  for (const file of [target.default, target.types]) {
    for (const [specifier, importer] of externalImports(join(packageRoot, file))) {
      if (isBuiltin(specifier)) {
        if (browserSafe) {
          errors.push(`${subpath}: ${show(importer)} imports Node built-in ${specifier}`);
        }
      } else if (!declared.has(packageName(specifier))) {
        errors.push(`${subpath}: ${show(importer)} imports ${specifier}, which is not a dependency or peer`);
      }
    }
  }
  if (browserSafe) {
    for (const problem of await browserBundleProblems(join(packageRoot, target.default))) {
      errors.push(`${subpath}: browser bundle ${problem}`);
    }
  }
  checked.push(`${subpath}${browserSafe ? " (browser)" : ""}`);
}

if (errors.length > 0) {
  for (const error of errors) {
    console.error(`check-dist: ${error}`);
  }
  process.exit(1);
}
console.log(`check-dist: ok (${checked.join(", ")})`);
