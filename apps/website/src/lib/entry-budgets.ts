/**
 * Entries the package README marks as importing nothing outside the package:
 * `/cost`, `/redact`, `/harness/events`, `/transcript/usage`.
 * See packages/agent-kit/README.md.
 */
export const NO_OUTSIDE_IMPORTS = [
  "@rivus/agent-kit/cost",
  "@rivus/agent-kit/redact",
  "@rivus/agent-kit/harness/events",
  "@rivus/agent-kit/transcript/usage"
] as const;

export interface ShownBudget {
  readonly entry: string;
  readonly label: string;
  readonly noImports: boolean;
}

const KIT_ENTRIES = [
  "/discovery",
  "/sessions",
  "/transcript",
  "/transcript/usage",
  "/cost",
  "/harness/events",
  "/harness",
  "/acp",
  "/redact"
] as const;

const COLLAB_ENTRIES = ["/process-lock", "/lease", "/lanes"] as const;

/** One row of a package `.size-limit.ts` default export. Extra fields are ignored. */
export interface SizeLimitEntry {
  readonly name: string;
  readonly limit: string;
}

/** `"1127 B"` becomes `"1.1 KB"` (decimal kilobytes, one decimal place). */
export function formatBudget(limit: string): string {
  const match = /^(\d+) B$/.exec(limit);
  if (!match?.[1]) {
    throw new Error(`Unrecognised size limit: ${limit}`);
  }
  const kilobytes = Number(match[1]) / 1000;
  return `${kilobytes.toFixed(1)} KB`;
}

function rowsFor(limits: Map<string, string>, packageName: string, entries: readonly string[]): ShownBudget[] {
  return entries.map((entry) => {
    const name = `${packageName}${entry}`;
    const limit = limits.get(name);
    if (limit === undefined) {
      throw new Error(`No size-limit entry for ${name}`);
    }
    return {
      entry,
      label: formatBudget(limit),
      noImports: (NO_OUTSIDE_IMPORTS as readonly string[]).includes(name)
    };
  });
}

function limitsOf(entries: readonly SizeLimitEntry[]): Map<string, string> {
  return new Map(entries.map((entry) => [entry.name, entry.limit]));
}

export function budgetsFromLimits(
  kit: readonly SizeLimitEntry[],
  collab: readonly SizeLimitEntry[]
): { readonly kit: ShownBudget[]; readonly collab: ShownBudget[] } {
  return {
    kit: rowsFor(limitsOf(kit), "@rivus/agent-kit", KIT_ENTRIES),
    collab: rowsFor(limitsOf(collab), "@rivus/agent-kit-collab", COLLAB_ENTRIES)
  };
}
