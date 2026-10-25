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
  readonly bytes: number;
}

export interface LandingStatFacts {
  readonly entryCount: number;
  readonly packageCount: number;
  readonly zeroDepCount: number;
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

export function parseBudgetBytes(limit: string): number {
  const match = /^(\d+) B$/.exec(limit);
  if (!match?.[1]) {
    throw new Error(`Unrecognised size limit: ${limit}`);
  }
  return Number(match[1]);
}

/** `"1127 B"` becomes `"1.1 KB"` (decimal kilobytes, one decimal place). */
export function formatBudget(limit: string): string {
  return `${(parseBudgetBytes(limit) / 1000).toFixed(1)} KB`;
}

/** Width of a budget bar, as a percentage of the largest entry in the same list. */
export function barFillPercent(bytes: number, largest: number): number {
  if (largest <= 0) {
    return 0;
  }
  return (bytes / largest) * 100;
}

export function factsFromLimits(kit: readonly SizeLimitEntry[], collab: readonly SizeLimitEntry[]): LandingStatFacts {
  const all = [...kit, ...collab];
  if (all[0] === undefined) {
    throw new Error("No size-limit entries");
  }
  return {
    entryCount: all.length,
    packageCount: (kit.length > 0 ? 1 : 0) + (collab.length > 0 ? 1 : 0),
    zeroDepCount: NO_OUTSIDE_IMPORTS.length
  };
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
      noImports: (NO_OUTSIDE_IMPORTS as readonly string[]).includes(name),
      bytes: parseBudgetBytes(limit)
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
