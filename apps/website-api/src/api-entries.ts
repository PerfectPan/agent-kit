export interface PublicEntry {
  readonly packageName: string;
  readonly subpath: string;
  readonly specifier: string;
  readonly slug: string;
  readonly typesRelative: string;
}

interface ExportTarget {
  readonly types?: string;
}

/** Public subpath exports, in `package.json` order. `./package.json` is not an entry. */
export function publicEntries(
  packageName: string,
  exportsMap: Readonly<Record<string, string | ExportTarget>>
): PublicEntry[] {
  const entries: PublicEntry[] = [];
  for (const [key, value] of Object.entries(exportsMap)) {
    if (key === "./package.json") {
      continue;
    }
    if (typeof value === "string" || value.types === undefined) {
      throw new Error(`${packageName} export ${key} has no types condition`);
    }
    if (!key.startsWith("./")) {
      throw new Error(`${packageName} export ${key} is not a relative subpath`);
    }
    const subpath = key.slice(2);
    entries.push({
      packageName,
      subpath,
      specifier: `${packageName}/${subpath}`,
      slug: subpath.replaceAll("/", "-"),
      typesRelative: value.types.replace(/^\.\//, "")
    });
  }
  return entries;
}

const ENTRY_ROW = /^\|\s+\[`(@rivus\/agent-kit(?:-collab)?\/[^`]+)`\]\([^)]+\)\s+\|\s+([^|]+?)\s+\|\s+([^|]+?)\s+\|$/;

/** One line per introduction entry-table row, keyed by the package specifier. */
export function entryBlurbs(introduction: string): Map<string, string> {
  const blurbs = new Map<string, string>();
  for (const line of introduction.split("\n")) {
    const match = ENTRY_ROW.exec(line);
    if (!match) {
      continue;
    }
    const specifier = match[1];
    if (specifier === undefined || match[2] === undefined || match[3] === undefined) {
      continue;
    }
    blurbs.set(specifier, `${match[2]} — ${match[3]}`);
  }
  return blurbs;
}

export function blurbFor(blurbs: ReadonlyMap<string, string>, specifier: string): string {
  const blurb = blurbs.get(specifier);
  if (blurb === undefined) {
    throw new Error(`Introduction entry table has no row for ${specifier}`);
  }
  return blurb;
}

export function missingDeclarationsMessage(packageName: string, missing: readonly string[]): string {
  return [
    `${packageName} has no built declarations:`,
    ...missing.map((file) => `  ${file}`),
    "Build the packages before the website (`pnpm run build` from the repository root)."
  ].join("\n");
}
