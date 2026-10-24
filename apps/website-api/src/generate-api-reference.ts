// Writes one MDX page per public entry of @rivus/agent-kit and @rivus/agent-kit-collab
// into content/docs/en/api, from the built declarations. Chinese gets only the
// sidebar folder (content/docs/zh/api/meta.json); the pages stay English and the
// docs shell shows the untranslated-page note. Run after the packages build.

import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { blurbFor, entryBlurbs, missingDeclarationsMessage, publicEntries } from "./api-entries.ts";
import type { PublicEntry } from "./api-entries.ts";
import { apiIndexBody, apiMetaPages, rewriteApiLinks, stripFrontmatter, withFrontmatter } from "./api-markdown.ts";
import type { IndexGroup } from "./api-markdown.ts";
import { absolutizeRelativeImports, prepareEntrySource } from "./prepare-declaration.ts";

const PACKAGES = ["@rivus/agent-kit", "@rivus/agent-kit-collab"] as const;

// Plural kind titles. Page sections first; member groups stay Constructors, Properties, Accessors, Methods.
const GROUP_ORDER = [
  "Functions",
  "Classes",
  "Interfaces",
  "Type Aliases",
  "Variables",
  "Constructors",
  "Properties",
  "Accessors",
  "Methods",
  "*"
];

const apiRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const websiteRoot = join(apiRoot, "../website");
const require = createRequire(join(websiteRoot, "package.json"));
const typedocRequire = createRequire(join(apiRoot, "package.json"));

interface BuiltEntry extends PublicEntry {
  readonly blurb: string;
  readonly typesFile: string;
}

function packageRoot(packageName: string): string {
  return dirname(require.resolve(`${packageName}/package.json`));
}

function readExports(root: string): Record<string, string | { readonly types?: string }> {
  const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as {
    exports?: Record<string, string | { readonly types?: string }>;
  };
  if (manifest.exports === undefined) {
    throw new Error(`${root} has no exports map`);
  }
  return manifest.exports;
}

function loadEntries(blurbs: ReadonlyMap<string, string>): {
  readonly groups: IndexGroup[];
  readonly entries: BuiltEntry[];
} {
  const groups: IndexGroup[] = [];
  const entries: BuiltEntry[] = [];
  for (const packageName of PACKAGES) {
    const root = packageRoot(packageName);
    const publicOnes = publicEntries(packageName, readExports(root));
    const missing = publicOnes.map((entry) => join(root, entry.typesRelative)).filter((file) => !existsSync(file));
    if (missing.length > 0) {
      throw new Error(missingDeclarationsMessage(packageName, missing));
    }
    const groupEntries = publicOnes.map((entry) => {
      const built: BuiltEntry = {
        ...entry,
        blurb: blurbFor(blurbs, entry.specifier),
        typesFile: join(root, entry.typesRelative)
      };
      entries.push(built);
      return { specifier: built.specifier, slug: built.slug, blurb: built.blurb };
    });
    groups.push({ packageName, entries: groupEntries });
  }
  return { groups, entries };
}

function tsPath(fromDirectory: string, target: string): string {
  const value = relative(fromDirectory, target).split("\\").join("/");
  return value.startsWith(".") ? value : `./${value}`;
}

function writePrepared(entries: readonly BuiltEntry[], directory: string): string[] {
  mkdirSync(directory, { recursive: true });
  const files: string[] = [];
  for (const entry of entries) {
    const prepared = absolutizeRelativeImports(
      prepareEntrySource(readFileSync(entry.typesFile, "utf8")),
      dirname(entry.typesFile)
    );
    if (/from "\./.test(prepared)) {
      throw new Error(`${entry.specifier} still has a relative import after preparation`);
    }
    const file = join(directory, `${entry.slug}.d.ts`);
    writeFileSync(file, prepared);
    files.push(file);
  }
  return files;
}

function writeProject(temp: string, entryFiles: readonly string[], kitRoot: string): string {
  const effectRoot = dirname(createRequire(join(kitRoot, "package.json")).resolve("effect/package.json"));
  const effectTypes = join(effectRoot, "dist/Effect.d.ts");
  if (!existsSync(effectTypes)) {
    throw new Error(`effect declarations are missing at ${effectTypes}. Build @rivus/agent-kit before the website.`);
  }
  const config = {
    compilerOptions: {
      target: "ES2022",
      module: "ESNext",
      moduleResolution: "bundler",
      strict: true,
      skipLibCheck: true,
      noEmit: true,
      baseUrl: ".",
      paths: {
        "@rivus/agent-kit/*": [`${tsPath(temp, join(kitRoot, "dist"))}/*`],
        "effect/*": [`${tsPath(temp, join(effectRoot, "dist"))}/*`]
      }
    },
    include: ["./**/*.d.ts"]
  };
  const configFile = join(temp, "tsconfig.json");
  writeFileSync(configFile, `${JSON.stringify(config, null, 2)}\n`);
  const options = {
    name: "agent-kit",
    plugin: ["typedoc-plugin-markdown"],
    router: "module",
    fileExtension: ".mdx",
    entryFileName: "index",
    readme: "none",
    hidePageHeader: true,
    hideBreadcrumbs: true,
    hidePageTitle: true,
    groupOrder: GROUP_ORDER,
    useCodeBlocks: true,
    expandParameters: true,
    disableSources: true,
    excludeExternals: true,
    skipErrorChecking: true,
    githubPages: false,
    sanitizeComments: true,
    logLevel: "Warn",
    suppressCommentWarningsInDeclarationFiles: true,
    validation: { notExported: false, invalidLink: true, notDocumented: false },
    tsconfig: configFile,
    entryPoints: entryFiles,
    out: join(temp, "out")
  };
  const optionsFile = join(temp, "typedoc.json");
  writeFileSync(optionsFile, `${JSON.stringify(options, null, 2)}\n`);
  return optionsFile;
}

function runTypedoc(optionsFile: string): void {
  const bin = join(dirname(typedocRequire.resolve("typedoc/package.json")), "bin/typedoc");
  const result = spawnSync(process.execPath, [bin, "--options", optionsFile], {
    cwd: apiRoot,
    stdio: "inherit"
  });
  if (result.status !== 0) {
    throw new Error(`TypeDoc exited with status ${result.status ?? "null"}`);
  }
}

function generatedPages(outDir: string): Map<string, string> {
  const pages = new Map<string, string>();
  const visit = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const full = join(directory, entry.name);
      if (entry.isDirectory()) {
        visit(full);
      } else if (entry.name.endsWith(".mdx")) {
        pages.set(entry.name.slice(0, -".mdx".length), readFileSync(full, "utf8"));
      }
    }
  };
  visit(outDir);
  return pages;
}

function pageBody(markdown: string, slug: string): string {
  const body = rewriteApiLinks(stripFrontmatter(markdown));
  if (body.includes(tmpdir()) || body.includes("/private/tmp/") || body.includes("/Users/")) {
    throw new Error(`${slug} documentation contains a local filesystem path`);
  }
  return body;
}

function writeSite(
  groups: readonly IndexGroup[],
  entries: readonly BuiltEntry[],
  pages: ReadonlyMap<string, string>
): void {
  const enDir = join(websiteRoot, "content/docs/en/api");
  const zhDir = join(websiteRoot, "content/docs/zh/api");
  rmSync(enDir, { recursive: true, force: true });
  rmSync(zhDir, { recursive: true, force: true });
  mkdirSync(enDir, { recursive: true });
  mkdirSync(zhDir, { recursive: true });

  for (const entry of entries) {
    const markdown = pages.get(entry.slug);
    if (markdown === undefined) {
      throw new Error(`TypeDoc wrote no page for ${entry.specifier}. Files: ${[...pages.keys()].sort().join(", ")}`);
    }
    const body = pageBody(markdown, entry.slug);
    writeFileSync(join(enDir, `${entry.slug}.mdx`), withFrontmatter(body, entry.specifier, entry.blurb));
  }
  writeFileSync(
    join(enDir, "index.mdx"),
    withFrontmatter(
      apiIndexBody(groups),
      "API reference",
      "Every published entry of @rivus/agent-kit and @rivus/agent-kit-collab."
    )
  );

  const meta = {
    title: "API reference",
    defaultOpen: true,
    pages: apiMetaPages(groups)
  };
  writeFileSync(join(enDir, "meta.json"), `${JSON.stringify(meta, null, 2)}\n`);
  writeFileSync(join(zhDir, "meta.json"), `${JSON.stringify({ ...meta, title: "API 参考" }, null, 2)}\n`);
}

const introduction = readFileSync(join(websiteRoot, "content/docs/en/index.mdx"), "utf8");
const { groups, entries } = loadEntries(entryBlurbs(introduction));
const temp = mkdtempSync(join(tmpdir(), "agent-kit-api-"));
try {
  const entryFiles = writePrepared(entries, join(temp, "entries"));
  const optionsFile = writeProject(temp, entryFiles, packageRoot("@rivus/agent-kit"));
  runTypedoc(optionsFile);
  const pages = generatedPages(join(temp, "out"));
  writeSite(groups, entries, pages);
  console.log(`generated ${entries.length + 1} API pages in content/docs/en/api`);
} finally {
  rmSync(temp, { recursive: true, force: true });
}
