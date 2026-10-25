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

export const KIT_GROUP_ORDER = ["read", "hook", "utilities"] as const;

export type KitGroupId = (typeof KIT_GROUP_ORDER)[number];

export const KIT_GROUP_ENTRIES: Record<KitGroupId, readonly string[]> = {
  read: ["/discovery", "/sessions", "/transcript", "/transcript/usage", "/cost"],
  hook: ["/harness/events", "/harness", "/acp"],
  utilities: ["/redact"]
};

const KIT_ENTRIES = KIT_GROUP_ORDER.flatMap((id) => KIT_GROUP_ENTRIES[id]);

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

/** Width of a budget bar, as a percentage of the shared scale (largest budget = 100%). */
export function barFillPercent(bytes: number, largest: number): number {
  if (largest <= 0) {
    return 0;
  }
  return (bytes / largest) * 100;
}

/** Largest compressed budget across both packages; one scale for both columns. */
export function largestBudgetBytes(kit: readonly ShownBudget[], collab: readonly ShownBudget[]): number {
  return Math.max(0, ...kit.map((entry) => entry.bytes), ...collab.map((entry) => entry.bytes));
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

export function groupedKitBudgets(
  kit: readonly ShownBudget[]
): { readonly id: KitGroupId; readonly entries: ShownBudget[] }[] {
  const byEntry = new Map(kit.map((row) => [row.entry, row]));
  return KIT_GROUP_ORDER.map((id) => ({
    id,
    entries: KIT_GROUP_ENTRIES[id].map((entry) => {
      const row = byEntry.get(entry);
      if (row === undefined) {
        throw new Error(`No budget row for ${entry}`);
      }
      return row;
    })
  }));
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
