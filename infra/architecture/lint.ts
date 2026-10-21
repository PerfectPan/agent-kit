/**
 * The boundary manifest as oxlint configuration. Every package's `vite.config.ts` passes its shared `lint` block
 * through `withBoundaryLint`, because `pnpm -r run lint` runs `vp lint` in each package and oxlint then reads only
 * that package's `lint` block; `manifest.test.ts` fails when a package under `packages/` does not. Each message starts
 * with the rule id in brackets, such as `[layer]`.
 *
 * - `boundaries/dependencies` (eslint-plugin-boundaries) checks every import of a `src/` file against policies
 *   generated from `boundaries.ts`. Workspace packages are flagged as external modules, so an import by package name
 *   is judged by its specifier, whatever it resolves to; a relative import is judged by the element of the file it
 *   resolves to. The policies are evaluated in order and the last matching one decides, so each group below first
 *   sets the message for what stays forbidden, then allows, then restricts again.
 * - `boundaries/no-unknown-files` reports `src/` files of a package that the manifest does not declare.
 * - `import/no-nodejs-modules` (built in) keeps Node built-ins in the packages that declare `nodeBuiltins`.
 * - `eslint-js/no-restricted-syntax` (oxlint-plugin-eslint) rejects computed dynamic imports, the statements a shell
 *   entry may not contain, non-`.ts` sources under `src/`, and agent markers spelled outside the agent adapters.
 *
 * Rules that concern manifests rather than source files (undeclared packages, `package.json` dependencies, entry
 * files) are checked by `manifest.test.ts`. `run-lint-cases.ts` lints the cases of `lint-cases.ts`, violating and
 * allowed ones for every rule.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

import type { DependenciesPolicy, ElementDescriptor } from "eslint-plugin-boundaries";
import { escapeRegExp } from "es-toolkit";
import type { OxlintConfig, OxlintOverride } from "vite-plus/lint";

import { boundaries, type Layer, type PackageRule } from "./boundaries.ts";

const ROOT = realpathSync(fileURLToPath(new URL("../..", import.meta.url)));
const MANIFEST = "infra/architecture/boundaries.ts";
const { resolve } = createRequire(import.meta.url);

/** `adapters` comes first: its folder sits inside `domain/`, and the first matching element wins. */
const LAYERS: readonly Layer[] = ["adapters", "domain", "application", "infra"];
const EFFECT_MODULES = [...boundaries.effect.modules];
const EFFECT_ENTRY = boundaries.effect.workspaceEntry.slice(1);
/** `import("x")` types and `import x = require("x")`, which are not among the plugin's default dependency nodes. */
const IMPORT_TYPE = "import-type";
const ADDITIONAL_DEPENDENCY_NODES = [
  { selector: "TSImportType > Literal", kind: "type", name: IMPORT_TYPE },
  {
    selector: "TSImportEqualsDeclaration[importKind='type'] > TSExternalModuleReference > Literal",
    kind: "type",
    name: "import-equals"
  },
  {
    selector: "TSImportEqualsDeclaration[importKind!='type'] > TSExternalModuleReference > Literal",
    kind: "value",
    name: "import-equals"
  }
];
const SOURCES = ["src/**/*.ts"];
const TESTS = ["src/**/*.{test,spec}.*"];
/** Declaration files get only the source-file rule, which rejects them under `src/`. */
const DECLARATIONS = "src/**/*.d.ts";

export interface Project {
  readonly name: string;
  /** Repository-relative POSIX folder, such as `packages/sessions`. */
  readonly folder: string;
}

/** The parts of the plugin's selectors that the policies use; `boundaryLintOf` checks them against its types. */
interface ModuleSelector {
  readonly origin?: string | string[];
  readonly source?: string | string[];
  readonly internalPath?: string | string[] | null;
}
interface Entity {
  readonly element?: { readonly type?: string; readonly isUnknown?: boolean; readonly path?: null };
  readonly file?: { readonly path?: string | string[]; readonly categories?: string };
  readonly module?: ModuleSelector;
}
interface Effect {
  readonly to: Entity | Entity[];
  readonly dependency?: {
    readonly kind?: "type" | "value";
    readonly source?: string | string[];
    readonly nodeKind?: string;
  };
}
interface Policy {
  readonly from: Entity;
  readonly allow?: Effect;
  readonly disallow?: Effect;
  readonly message?: string;
}

/**
 * The workspace projects other than the root, as `pnpm ls -r --depth -1 --json` lists them. pnpm decides membership
 * from the globs in pnpm-workspace.yaml, so a new folder there is covered without registering it. pnpm reports real
 * paths, so `root` must be a real path too.
 */
export function workspaceProjects(root: string): Project[] {
  const listed = execFileSync("pnpm", ["ls", "-r", "--depth", "-1", "--json"], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024
  });
  return (JSON.parse(listed) as { name: string; path: string }[])
    .map(({ name, path }) => ({ name, folder: relative(root, path).split("\\").join("/") }))
    .filter(({ folder }) => folder !== "");
}

/** The boundary rules cover the projects under `packages/`. */
const projects = workspaceProjects(ROOT).filter(({ folder }) => folder.startsWith("packages/"));

/** Packages that shells bundle and re-export: declared, without published entries of their own. */
const internalNames = Object.entries(boundaries.packages)
  .filter(([, rule]) => rule.entries === undefined)
  .map(([name]) => name);
const workspaceNames = [...new Set([...internalNames, ...boundaries.shells, ...projects.map(({ name }) => name)])];
const isShell = (name: string): boolean => boundaries.shells.includes(name);

const braces = (items: readonly string[]): string => (items.length === 1 ? (items[0] ?? "") : `{${items.join(",")}}`);
const typeOf = (project: Project, kind: string): string =>
  `${project.folder.slice("packages/".length)}:${kind === "src" && boundaries.packages[project.name]?.providerServices ? "provider" : kind}`;
const element = (project: Project, kind: string): Entity => ({ element: { type: typeOf(project, kind) } });
const local = (project: Project, kind = "*"): Entity => ({ ...element(project, kind), module: { origin: "local" } });
const external = (module: ModuleSelector = {}): Entity => ({ module: { origin: "external", ...module } });

/**
 * Node built-ins. The plugin looks a specifier up in `builtinModules` without its `node:` prefix, so it files the
 * prefix-only built-ins, such as `node:sqlite`, as external packages.
 */
const NODE_BUILTINS: Entity[] = [{ module: { origin: "core" } }, external({ source: "node:*" })];

/** Layer folders first, then the rest of `src/`, then the rest of the package; each file gets the first match. */
function elementsOf(project: Project): ElementDescriptor[] {
  const entries = boundaries.packages[project.name]?.entries;
  const bases = [
    `${project.folder}/src`,
    ...(entries === undefined ? [] : [`${project.folder}/src/${braces(entries)}`])
  ];
  const layers = isShell(project.name)
    ? []
    : LAYERS.flatMap((layer) =>
        bases.map((base) => ({
          type: typeOf(project, layer),
          pattern: layer === "adapters" ? `${base}/domain/*/adapters` : `${base}/${layer}`
        }))
      );
  return [
    ...layers,
    { type: typeOf(project, "src"), pattern: `${project.folder}/src` },
    { type: typeOf(project, "package"), pattern: project.folder }
  ].map((descriptor) => ({ ...descriptor, partialMatch: false, exclusive: true }));
}

interface Target {
  readonly plain: ModuleSelector[];
  readonly effect: ModuleSelector[];
}

/**
 * The internal packages a package may import and the specifiers that reach them: the package name (and its Effect
 * entry) for each of `dependsOn`, or the shell entries of `publicImports` mapped to the package they publish.
 */
function targetsOf(rule: PackageRule): Map<string, Target> {
  const targets = new Map<string, Target>();
  const add = (name: string, kind: keyof Target, module: ModuleSelector) => {
    const target = targets.get(name) ?? { plain: [], effect: [] };
    target[kind].push(module);
    targets.set(name, target);
  };
  if (rule.publicImports === undefined) {
    for (const name of rule.dependsOn) {
      add(name, "plain", { source: name, internalPath: null });
      add(name, "effect", { source: name, internalPath: EFFECT_ENTRY });
    }
    for (const name of rule.spiImports ?? []) {
      if (boundaries.packages[name]?.spi) {
        add(name, "plain", { source: name, internalPath: "spi" });
      }
    }
    return targets;
  }
  for (const [specifier, published] of Object.entries(rule.publicImports)) {
    const shell = boundaries.shells.find((name) => specifier.startsWith(`${name}/`));
    if (shell !== undefined && rule.dependsOn.includes(shell)) {
      const module = { source: shell, internalPath: specifier.slice(shell.length + 1) };
      const isEffect = published.endsWith(boundaries.effect.workspaceEntry);
      add(
        isEffect ? published.slice(0, -boundaries.effect.workspaceEntry.length) : published,
        isEffect ? "effect" : "plain",
        module
      );
    }
  }
  return targets;
}

const modulesOf = (targets: Iterable<Target>): Entity[] =>
  [...targets].flatMap(({ plain, effect }) => [...plain, ...effect].map((module) => external(module)));

/** Root-relative patterns for the package-relative prefixes of `effect.allowedPaths`. */
const effectPathsOf = (project: Project): string[] =>
  (boundaries.effect.allowedPaths[project.name] ?? []).map((prefix) =>
    prefix.endsWith("/") ? `${project.folder}/${prefix}**` : `${project.folder}/${prefix}`
  );

function shellPolicies(project: Project): Policy[] {
  return [
    {
      from: element(project, "src"),
      disallow: { to: [external(), { module: { origin: ["local", "core"] } }] },
      message: `[shell-entry] {{dependency.source}}: import an internal package's public entry or a declared local binding, "<package>/public[/<name>]"`
    },
    {
      from: element(project, "src"),
      allow: {
        to: external({
          source: internalNames.filter((name) => boundaries.packages[name]?.providerServices === undefined),
          internalPath: ["public", "public/+([a-z0-9-])"]
        })
      }
    },
    ...Object.entries(boundaries.packages).flatMap(([name, rule]): Policy[] =>
      (rule.providerServices ?? []).map((service): Policy => ({
        from: { ...element(project, "src"), file: { path: `${project.folder}/src/providers/${service}.ts` } },
        allow: { to: external({ source: name, internalPath: service }) }
      }))
    ),
    ...Object.entries(boundaries.shellImports).map(([file, sources]): Policy => ({
      from: { ...element(project, "src"), file: { path: `${project.folder}/${file}` } },
      allow: { to: local(project), dependency: { source: [...sources] } }
    }))
  ];
}

/** Messages for what no later policy allows: npm packages, workspace packages, and relative imports. */
function forbiddenByDefault(project: Project, rule: PackageRule): Policy[] {
  const all = element(project, "*");
  return [
    {
      from: all,
      disallow: { to: external() },
      message: `[external-dependency] {{dependency.source}}: not in the external allowlist of ${project.name}, which lists exact specifiers (${MANIFEST})`
    },
    {
      from: element(project, "domain"),
      disallow: { to: external() },
      message: "[external-dependency] {{dependency.source}}: domain/ may not import npm packages"
    },
    {
      from: all,
      disallow: { to: external({ source: workspaceNames }) },
      message: `[package-dependency] {{dependency.source}}: ${project.name} may not depend on {{to.module.source}} (see ${MANIFEST})`
    },
    ...(rule.testsOnly ?? []).map((name): Policy => ({
      from: all,
      disallow: { to: external({ source: name }) },
      message: `[package-dependency] {{dependency.source}}: only the tests of ${project.name} may use ${name} (see ${MANIFEST})`
    })),
    {
      from: all,
      disallow: { to: local(project) },
      message: "[layer] {{dependency.source}}: {{from.element.type}} may not import {{to.element.type}}"
    },
    {
      from: all,
      disallow: {
        to: [
          { element: { type: `!${typeOf(project, "*")}` }, module: { origin: "local" } },
          { element: { isUnknown: true }, module: { origin: "local" } }
        ]
      },
      message: `[relative-escape] {{dependency.source}}: leaves ${project.name}; import another package by its name`
    },
    {
      from: all,
      disallow: { to: { element: { isUnknown: true, path: null }, module: { origin: "local" } } },
      message: "[unresolved] {{dependency.source}}: the import resolver found no file"
    }
  ];
}

function allowed(project: Project, rule: PackageRule, targets: Map<string, Target>): Policy[] {
  const kinds = ["src", ...LAYERS] as const;
  const workspace = kinds.flatMap((kind): Policy[] => {
    const mode = kind === "src" ? "any" : boundaries.layers[kind].workspace;
    const hidden = kind === "src" ? [] : (boundaries.layers[kind].hidden ?? []);
    return [...targets].flatMap(([name, target]): Policy[] => {
      if (mode === "any" || name === boundaries.sharedKernel) {
        return [{ from: element(project, kind), allow: { to: modulesOf([target]) } }];
      }
      return mode === "kernel-and-types" && !hidden.includes(name)
        ? [{ from: element(project, kind), allow: { to: modulesOf([target]), dependency: { kind: "type" } } }]
        : [];
    });
  });
  const everywhere = rule.external.filter((specifier) => rule.externalOnlyIn?.[specifier] === undefined);
  const npm = kinds
    .filter((kind) => everywhere.length > 0 && (kind === "src" || boundaries.layers[kind].external))
    .map((kind): Policy => ({
      from: element(project, kind),
      allow: { to: external(), dependency: { source: everywhere } }
    }));
  const effectPaths = effectPathsOf(project);
  return [
    { from: element(project, "src"), allow: { to: local(project) } },
    ...LAYERS.map((layer): Policy => ({
      from: element(project, layer),
      allow: { to: boundaries.layers[layer].layers.map((target) => local(project, target)) }
    })),
    ...workspace,
    ...npm,
    ...Object.entries(rule.externalOnlyIn ?? {}).map(([specifier, files]): Policy => ({
      from: { file: { path: files.map((file) => `${project.folder}/${file}`) } },
      allow: { to: external(), dependency: { source: specifier } }
    })),
    ...(effectPaths.length === 0
      ? []
      : [{ from: { file: { path: effectPaths } }, allow: { to: external({ source: EFFECT_MODULES }) } }]),
    // Node built-ins are left to import/no-nodejs-modules.
    { from: element(project, "*"), allow: { to: NODE_BUILTINS } }
  ];
}

/** Restrictions over the allowed imports, in increasing precedence, so that the most specific rule id names a violation. */
function restricted(project: Project, rule: PackageRule, targets: Map<string, Target>): Policy[] {
  const all = element(project, "*");
  const kernel = boundaries.sharedKernel;
  const effectPaths = effectPathsOf(project);
  const layerRestrictions = LAYERS.flatMap((layer): Policy[] => {
    const { workspace, hidden = [] } = boundaries.layers[layer];
    const others = [...targets].filter(([name]) => name !== kernel);
    const visible = others.filter(([name]) => !hidden.includes(name)).map(([, target]) => target);
    const invisible = others.filter(([name]) => hidden.includes(name)).map(([, target]) => target);
    const from = element(project, layer);
    const policies: Policy[] = [];
    if (workspace === "kernel" && visible.length > 0) {
      policies.push({
        from,
        disallow: { to: modulesOf(visible) },
        message: `[layer] {{dependency.source}}: ${layer}/ may only import the shared kernel ${kernel}`
      });
    }
    if (workspace === "kernel-and-types" && visible.length > 0) {
      policies.push({
        from,
        disallow: { to: modulesOf(visible), dependency: { kind: "value" } },
        message: `[layer] {{dependency.source}}: ${layer}/ may only use import type / export type from {{to.module.source}}`
      });
    }
    if (invisible.length > 0) {
      policies.push({
        from,
        disallow: { to: modulesOf(invisible) },
        message: `[layer] {{dependency.source}}: ${layer}/ may not import it, not even its types`
      });
    }
    return policies;
  });
  const shellEntries =
    rule.publicImports === undefined
      ? [external({ source: [...boundaries.shells] })]
      : boundaries.shells.flatMap((shell) => {
          const entries = Object.keys(rule.publicImports ?? {})
            .filter((specifier) => specifier.startsWith(`${shell}/`))
            .map((specifier) => specifier.slice(shell.length + 1));
          return [
            external({ source: shell, internalPath: null }),
            external({ source: shell, internalPath: entries.length === 0 ? "**" : `!${braces(entries)}` })
          ];
        });
  return [
    ...(rule.typesOnly ?? []).map((name): Policy => ({
      from: all,
      disallow: {
        to: modulesOf([...targets].filter(([target]) => target === name).map(([, target]) => target)),
        dependency: { kind: "value" }
      },
      message: `[types-only] {{dependency.source}}: ${project.name} may only use import type / export type from ${name} (see ${MANIFEST})`
    })),
    ...layerRestrictions,
    ...Object.entries(rule.externalOnlyIn ?? {}).map(([specifier, files]): Policy => ({
      from: { ...all, file: { path: `!${braces(files.map((file) => `${project.folder}/${file}`))}` } },
      disallow: { to: external(), dependency: { source: specifier } },
      message: `[external-dependency] {{dependency.source}}: only ${files.join(", ")} of ${project.name} may import it (${MANIFEST})`
    })),
    {
      from: all,
      disallow: {
        to: external({
          source: workspaceNames.filter((name) => !isShell(name) && !boundaries.packages[name]?.providerServices),
          internalPath: `!{${EFFECT_ENTRY},spi}`
        })
      },
      message: "[deep-import] {{dependency.source}}: import {{to.module.source}} itself, which resolves to its index.ts"
    },
    {
      from: all,
      disallow: {
        to: external({
          source: workspaceNames.filter((name) => !rule.spiImports?.includes(name) || !boundaries.packages[name]?.spi),
          internalPath: "spi"
        })
      },
      message: `[spi-import] {{dependency.source}}: declare the dependency's SPI access under spiImports in ${MANIFEST}`
    },
    {
      from: effectPaths.length === 0 ? all : { ...all, file: { path: `!${braces(effectPaths)}` } },
      disallow: {
        to: [
          external({ source: EFFECT_MODULES }),
          ...(rule.publicImports === undefined
            ? [external({ source: workspaceNames, internalPath: EFFECT_ENTRY })]
            : [...targets.values()].flatMap(({ effect }) => effect.map((module) => external(module)))),
          { ...local(project), file: { categories: "effect-entry" } }
        ]
      },
      message: `[effect] {{dependency.source}}: Effect is only allowed in the paths listed under effect in ${MANIFEST}`
    },
    {
      from: all,
      disallow: { to: shellEntries },
      message: `[public-entry] {{dependency.source}}: import one of the public entries of {{to.module.source}} listed under publicImports in ${MANIFEST}`
    },
    // import/no-nodejs-modules does not see `import("node:…")` types.
    ...(rule.nodeBuiltins === true
      ? []
      : [
          {
            from: all,
            disallow: { to: NODE_BUILTINS, dependency: { nodeKind: IMPORT_TYPE } },
            message: "[node-builtin] {{dependency.source}}: only the Node platform package may import Node built-ins"
          }
        ])
  ];
}

function policiesOf(project: Project): Policy[] {
  if (isShell(project.name)) {
    return shellPolicies(project);
  }
  const rule = boundaries.packages[project.name];
  if (rule === undefined) {
    return [];
  }
  const targets = targetsOf(rule);
  return [
    ...forbiddenByDefault(project, rule),
    ...allowed(project, rule, targets),
    ...restricted(project, rule, targets),
    ...(rule.providerServices === undefined
      ? []
      : Object.entries({
          hooks: ["./facts.js", "@rivus/agent-kit-harness/spi", "zod/mini"],
          usage: [
            "./facts.js",
            "./layout.js",
            "./records.js",
            "./records/**",
            "@rivus/agent-kit-sessions/spi",
            "zod/mini"
          ]
        }).flatMap(([service, sources]): Policy[] => {
          const from = { ...element(project, "src"), file: { path: `${project.folder}/src/${service}.ts` } };
          return [
            {
              from,
              disallow: { to: [external(), { module: { origin: ["local", "core"] } }] },
              message: `[provider-entry] {{dependency.source}}: ${service} must keep its slim import graph`
            },
            { from, allow: { to: [external(), local(project)], dependency: { source: sources } } }
          ];
        }))
  ];
}

const MARKERS = boundaries.agentMarkers.markers.map((marker) => escapeRegExp(marker)).join("|");
/** A module specifier is a Literal too; the boundary rules judge it instead. */
const MODULE_SPECIFIERS = [
  "ImportDeclaration > Literal",
  "ExportAllDeclaration > Literal",
  "ExportNamedDeclaration > Literal",
  "ImportExpression > Literal",
  "TSImportType > Literal",
  "TSExternalModuleReference > Literal"
].join(", ");
const AGENT_MARKER_MESSAGE = `[agent-marker] this value names one agent, and agent knowledge belongs in the agent adapters (markers in ${MANIFEST})`;

/** A rule entry at error level with the given options. */
const error = (...options: unknown[]): ["error", ...unknown[]] => ["error", ...options];

const syntax = {
  dynamicImport: {
    selector: "ImportExpression[source.type!='Literal']",
    message:
      "[dynamic-import] dynamic import() needs a string literal specifier so that the import graph can be checked"
  },
  shellEntry: [
    { selector: "ExportAllDeclaration", message: "[shell-entry] list re-exported names instead of export *" }
  ],
  // A string literal or literal type whose whole value is a marker, and a piece of a template literal's static text
  // (each part between expressions, split on `/`) that is one. Comments are not nodes, so they are never reported.
  agentMarker: [
    { selector: `Literal[value=/^(?:${MARKERS})$/]:not(${MODULE_SPECIFIERS})`, message: AGENT_MARKER_MESSAGE },
    {
      selector: `TemplateElement[value.cooked=/(?:^|\\/)(?:${MARKERS})(?:\\/|$)/]:not(ImportExpression > TemplateLiteral > TemplateElement)`,
      message: AGENT_MARKER_MESSAGE
    }
  ],
  sourceFile: {
    selector: "Program",
    message:
      "[source-file] only .ts sources belong under src/; declaration and JavaScript files bypass the import check"
  }
};

interface BoundaryLint {
  readonly jsPlugins: NonNullable<OxlintConfig["jsPlugins"]>;
  readonly settings: NonNullable<OxlintConfig["settings"]>;
  readonly overrides: NonNullable<OxlintConfig["overrides"]>;
}

/** The plugins, settings and overrides that apply the boundary rules to the package in the repository-relative `folder`. */
export function boundaryLintOf(folder: string): BoundaryLint {
  const manifest = JSON.parse(readFileSync(`${ROOT}/${folder}/package.json`, "utf8")) as { name: string };
  const project = { name: manifest.name, folder };
  const rule = boundaries.packages[project.name];
  const markerExemptions = boundaries.agentMarkers.packages[project.name];
  const base = isShell(project.name) ? [syntax.dynamicImport, ...syntax.shellEntry] : [syntax.dynamicImport];
  const policies: DependenciesPolicy[] = policiesOf(project);
  const overrides: OxlintOverride[] = [
    {
      files: SOURCES,
      excludeFiles: [...TESTS, DECLARATIONS],
      // A package may replace the top-level plugin list; the Node boundary rule still needs its built-in plugin.
      plugins: ["import"],
      rules: {
        "boundaries/dependencies": error({
          default: "disallow",
          checkAllOrigins: true,
          checkUnknownLocals: true,
          checkInternals: true,
          policies
        }),
        "boundaries/no-unknown-files": "error",
        "import/no-nodejs-modules": rule?.nodeBuiltins === true ? "off" : "error",
        "eslint-js/no-restricted-syntax": error(...base)
      }
    },
    ...(markerExemptions === undefined
      ? []
      : [
          {
            files: SOURCES,
            excludeFiles: [...TESTS, DECLARATIONS, ...boundaries.agentMarkers.exempt, ...markerExemptions],
            rules: { "eslint-js/no-restricted-syntax": error(...base, ...syntax.agentMarker) }
          }
        ]),
    {
      files: ["src/**/*.{d.ts,js,jsx,mjs,cjs,mts,cts,tsx}"],
      excludeFiles: TESTS,
      rules: { "eslint-js/no-restricted-syntax": error(syntax.sourceFile) }
    }
  ];
  return {
    jsPlugins: [
      { name: "boundaries", specifier: resolve("eslint-plugin-boundaries") },
      { name: "eslint-js", specifier: resolve("oxlint-plugin-eslint") }
    ],
    settings: {
      "boundaries/root-path": ROOT,
      "boundaries/elements": projects
        .filter(({ name }) => isShell(name) || boundaries.packages[name] !== undefined)
        .flatMap(elementsOf),
      "boundaries/files": projects.map(({ folder }) => ({
        category: "effect-entry",
        pattern: `${folder}/src${boundaries.effect.workspaceEntry}.ts`
      })),
      "boundaries/flag-as-external": { customSourcePatterns: workspaceNames.flatMap((name) => [name, `${name}/**`]) },
      "boundaries/additional-dependency-nodes": ADDITIONAL_DEPENDENCY_NODES,
      "boundaries/legacy-templates": false,
      "import/resolver": { typescript: { alwaysTryTypes: true } }
    },
    overrides
  };
}

/** Adds the boundary rules to a package's lint block; `configUrl` is the `import.meta.url` of its `vite.config.ts`. */
export function withBoundaryLint(lint: OxlintConfig, configUrl: string): OxlintConfig {
  const folder = relative(ROOT, realpathSync(dirname(fileURLToPath(configUrl))))
    .split("\\")
    .join("/");
  const boundary = boundaryLintOf(folder);
  return {
    ...lint,
    jsPlugins: [...(lint.jsPlugins ?? []), ...boundary.jsPlugins],
    settings: { ...lint.settings, ...boundary.settings },
    overrides: [...(lint.overrides ?? []), ...boundary.overrides]
  };
}
