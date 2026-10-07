import { isBuiltin } from "node:module";
import { posix } from "node:path";

import { type ParseResult, parseSync, Visitor } from "oxc-parser";

import type { BoundaryRules, Layer, PackageRule } from "./boundaries.ts";

export interface WorkspacePackage {
  readonly name: string;
  /** Repository-relative POSIX path, such as `packages/platform`. */
  readonly folder: string;
  /** Dependencies declared with the `workspace:` protocol in any dependency field of `package.json`. */
  readonly workspaceDependencies: readonly string[];
}

export interface SourceFile {
  /** Repository-relative POSIX path. */
  readonly path: string;
  readonly source: string;
}

export interface Workspace {
  readonly packages: readonly WorkspacePackage[];
  /** Every non-test code file under each package's `src/`, including declaration and JavaScript files. */
  readonly files: readonly SourceFile[];
}

export type RuleId =
  | "undeclared-package"
  | "entry-file"
  | "source-file"
  | "package-dependency"
  | "deep-import"
  | "relative-escape"
  | "layer"
  | "node-builtin"
  | "effect"
  | "external-dependency"
  | "shell-entry"
  | "dynamic-import"
  | "parse";

export interface Violation {
  readonly file: string;
  readonly rule: RuleId;
  readonly message: string;
}

type Statement = ParseResult["program"]["body"][number];

interface ImportRef {
  readonly specifier: string;
  /** Declaration-level `import type` / `export type`. `import { type X }` still loads the module at runtime. */
  readonly typeOnly: boolean;
}

const LAYERS: readonly Layer[] = ["domain", "agents", "protocols", "application", "adapters"];
const MANIFEST = "infra/architecture/boundaries.ts";
const PLAIN_TS = /(?<!\.d)\.ts$/;

function splitSpecifier(specifier: string): { name: string; subpath: string } {
  const parts = specifier.split("/");
  const size = specifier.startsWith("@") ? 2 : 1;
  const rest = parts.slice(size).join("/");
  return { name: parts.slice(0, size).join("/"), subpath: rest === "" ? "" : `/${rest}` };
}

function layerOf(pkg: WorkspacePackage, path: string): Layer | undefined {
  const [src, layer, ...rest] = path.slice(pkg.folder.length + 1).split("/");
  return src === "src" && rest.length > 0 ? LAYERS.find((candidate) => candidate === layer) : undefined;
}

function readImports(file: SourceFile): { imports: ImportRef[]; problems: Violation[]; body: readonly Statement[] } {
  const result = parseSync(file.path, file.source);
  const problems: Violation[] = result.errors.map((error) => ({
    file: file.path,
    rule: "parse",
    message: error.message
  }));
  const imports: ImportRef[] = [];
  for (const node of result.program.body) {
    if (node.type === "ImportDeclaration") {
      imports.push({ specifier: node.source.value, typeOnly: node.importKind === "type" });
    } else if (node.type === "ExportAllDeclaration") {
      imports.push({ specifier: node.source.value, typeOnly: node.exportKind === "type" });
    } else if (node.type === "ExportNamedDeclaration" && node.source !== null) {
      imports.push({ specifier: node.source.value, typeOnly: node.exportKind === "type" });
    } else if (node.type === "TSImportEqualsDeclaration" && node.moduleReference.type === "TSExternalModuleReference") {
      imports.push({ specifier: node.moduleReference.expression.value, typeOnly: node.importKind === "type" });
    }
  }
  new Visitor({
    ImportExpression(node) {
      if (node.source.type === "Literal" && typeof node.source.value === "string") {
        imports.push({ specifier: node.source.value, typeOnly: false });
      } else {
        problems.push({
          file: file.path,
          rule: "dynamic-import",
          message: "dynamic import() needs a string literal specifier so that the import graph can be checked"
        });
      }
    },
    TSImportType(node) {
      imports.push({ specifier: node.source.value, typeOnly: true });
    }
  }).visit(result.program);
  return { imports, problems, body: result.program.body };
}

/** Returns every boundary violation in the workspace; an empty list means the import graph matches the manifest. */
export function checkBoundaries(workspace: Workspace, rules: BoundaryRules): Violation[] {
  const violations: Violation[] = [];
  const internal = new Set(Object.keys(rules.packages));
  const workspaceNames = new Set([...internal, ...rules.shells, ...workspace.packages.map((pkg) => pkg.name)]);
  const paths = new Set(workspace.files.map((file) => file.path));

  for (const pkg of workspace.packages) {
    const file = `${pkg.folder}/package.json`;
    const isShell = rules.shells.includes(pkg.name);
    const rule = rules.packages[pkg.name];
    if (rule === undefined && !isShell) {
      violations.push({ file, rule: "undeclared-package", message: `${pkg.name} is not declared in ${MANIFEST}` });
      continue;
    }
    if (rule !== undefined) {
      for (const entry of ["src/index.ts", "src/public.ts"]) {
        if (!paths.has(`${pkg.folder}/${entry}`)) {
          violations.push({ file, rule: "entry-file", message: `${pkg.name} needs ${entry}` });
        }
      }
    }
    for (const dependency of pkg.workspaceDependencies) {
      if (isShell ? !internal.has(dependency) : !rule?.dependsOn.includes(dependency)) {
        violations.push({
          file,
          rule: "package-dependency",
          message: `${pkg.name} may not depend on ${dependency} (see ${MANIFEST})`
        });
      }
    }
  }

  const owners = workspace.packages.toSorted((a, b) => b.folder.length - a.folder.length);
  for (const file of workspace.files) {
    const pkg = owners.find((candidate) => file.path.startsWith(`${candidate.folder}/`));
    if (pkg === undefined) {
      continue;
    }
    if (!PLAIN_TS.test(file.path)) {
      violations.push({
        file: file.path,
        rule: "source-file",
        message: "only .ts sources belong under src/; declaration and JavaScript files bypass the import check"
      });
      continue;
    }
    const { imports, problems, body } = readImports(file);
    violations.push(...problems);
    if (rules.shells.includes(pkg.name)) {
      violations.push(...checkShellEntry(file, body, internal));
      continue;
    }
    const rule = rules.packages[pkg.name];
    if (rule === undefined) {
      continue;
    }
    const layer = layerOf(pkg, file.path);
    for (const ref of imports) {
      const message = checkImport({ rules, rule, pkg, layer, file, ref, workspaceNames });
      if (message !== undefined) {
        violations.push({ file: file.path, rule: message.rule, message: `${ref.specifier}: ${message.text}` });
      }
    }
  }
  return violations;
}

interface ImportContext {
  readonly rules: BoundaryRules;
  readonly rule: PackageRule;
  readonly pkg: WorkspacePackage;
  readonly layer: Layer | undefined;
  readonly file: SourceFile;
  readonly ref: ImportRef;
  readonly workspaceNames: ReadonlySet<string>;
}

function checkImport(context: ImportContext): { rule: RuleId; text: string } | undefined {
  const { rules, rule, pkg, layer, file, ref, workspaceNames } = context;
  const layerRule = layer === undefined ? undefined : rules.layers[layer];

  if (ref.specifier.startsWith(".") || ref.specifier.startsWith("/")) {
    const target = posix.normalize(posix.join(posix.dirname(file.path), ref.specifier));
    if (!target.startsWith(`${pkg.folder}/`)) {
      return { rule: "relative-escape", text: `leaves ${pkg.name}; import another package by its name` };
    }
    const targetLayer = layerOf(pkg, target);
    if (layerRule !== undefined && (targetLayer === undefined || !layerRule.layers.includes(targetLayer))) {
      return { rule: "layer", text: `${layer}/ may not import ${targetLayer ?? "files outside the layers"}/` };
    }
    return undefined;
  }

  if (rules.effect.specifier.test(ref.specifier)) {
    const relativePath = file.path.slice(pkg.folder.length + 1);
    const allowed = rules.effect.allowedPaths[pkg.name] ?? [];
    return allowed.some((prefix) => relativePath.startsWith(prefix))
      ? undefined
      : { rule: "effect", text: `Effect is only allowed in the paths listed under effect in ${MANIFEST}` };
  }

  if (isBuiltin(ref.specifier)) {
    return rule.nodeBuiltins === true
      ? undefined
      : { rule: "node-builtin", text: "only the Node platform package may import Node built-ins" };
  }

  const { name, subpath } = splitSpecifier(ref.specifier);
  if (workspaceNames.has(name)) {
    if (subpath !== "") {
      return { rule: "deep-import", text: `import ${name} itself, which resolves to its index.ts` };
    }
    if (!rule.dependsOn.includes(name)) {
      return { rule: "package-dependency", text: `${pkg.name} may not depend on ${name} (see ${MANIFEST})` };
    }
    if (layerRule?.hidden?.includes(name) === true) {
      return { rule: "layer", text: `${layer}/ may not import ${name}, not even its types` };
    }
    const mode = layerRule?.workspace ?? "any";
    const allowed = mode === "any" || name === rules.sharedKernel || (mode === "kernel-and-types" && ref.typeOnly);
    return allowed
      ? undefined
      : {
          rule: "layer",
          text:
            mode === "kernel"
              ? `${layer}/ may only import the shared kernel ${rules.sharedKernel}`
              : `${layer}/ may only use import type / export type from ${name}`
        };
  }

  if (layerRule !== undefined && !layerRule.external) {
    return { rule: "external-dependency", text: `${layer}/ may not import npm packages` };
  }
  return rule.external.includes(ref.specifier)
    ? undefined
    : {
        rule: "external-dependency",
        text: `not in the external allowlist of ${pkg.name}, which lists exact specifiers (${MANIFEST})`
      };
}

function checkShellEntry(file: SourceFile, body: readonly Statement[], internal: ReadonlySet<string>): Violation[] {
  const violations: Violation[] = [];
  for (const node of body) {
    if (node.type === "ExportAllDeclaration") {
      violations.push({ file: file.path, rule: "shell-entry", message: "list re-exported names instead of export *" });
    } else if (node.type !== "ExportNamedDeclaration" || node.source === null || node.declaration !== null) {
      violations.push({
        file: file.path,
        rule: "shell-entry",
        message: 'shell entries only re-export names: export { … } from "<internal package>/public"'
      });
    } else {
      const { name, subpath } = splitSpecifier(node.source.value);
      // "<package>/public/<name>" is a lighter public entry, such as the hook path of harness.
      if (!internal.has(name) || !/^\/public(?:\/[a-z0-9-]+)?$/.test(subpath)) {
        violations.push({
          file: file.path,
          rule: "shell-entry",
          message: `${node.source.value}: re-export from an internal package's public entry, "<package>/public[/<name>]"`
        });
      }
    }
  }
  return violations;
}
