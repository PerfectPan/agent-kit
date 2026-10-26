import { expect, it } from "vite-plus/test";

import {
  NO_OUTSIDE_IMPORTS,
  barFillPercent,
  budgetsFromLimits,
  factsFromLimits,
  formatBudget,
  groupedKitBudgets,
  largestBudgetBytes,
  parseBudgetBytes,
  type SizeLimitEntry
} from "./entry-budgets.ts";

const kit: readonly SizeLimitEntry[] = [
  { name: "@rivus/agent-kit/discovery", limit: "11843 B" },
  { name: "@rivus/agent-kit/sessions", limit: "24676 B" },
  { name: "@rivus/agent-kit/transcript", limit: "24886 B" },
  { name: "@rivus/agent-kit/transcript/usage", limit: "19189 B" },
  { name: "@rivus/agent-kit/cost", limit: "1127 B" },
  { name: "@rivus/agent-kit/cost/prices", limit: "3000 B" },
  { name: "@rivus/agent-kit/harness/events", limit: "7826 B" },
  { name: "@rivus/agent-kit/harness", limit: "82765 B" },
  { name: "@rivus/agent-kit/acp", limit: "44633 B" },
  { name: "@rivus/agent-kit/redact", limit: "1088 B" }
];

const collab: readonly SizeLimitEntry[] = [
  { name: "@rivus/agent-kit-collab/process-lock", limit: "6762 B" },
  { name: "@rivus/agent-kit-collab/lease", limit: "11102 B" },
  { name: "@rivus/agent-kit-collab/lanes", limit: "1945 B" }
];

it("formats a byte limit as decimal kilobytes", () => {
  expect(formatBudget("1127 B")).toBe("1.1 KB");
  expect(formatBudget("1088 B")).toBe("1.1 KB");
  expect(formatBudget("11843 B")).toBe("11.8 KB");
});

it("reads name and limit from size-limit entries", () => {
  const budgets = budgetsFromLimits(kit, collab);
  expect(budgets.kit.find((entry) => entry.entry === "/cost")).toEqual({
    entry: "/cost",
    label: "1.1 KB",
    noImports: true,
    bytes: 1127
  });
  expect(budgets.kit.find((entry) => entry.entry === "/discovery")?.noImports).toBe(false);
  expect(budgets.collab.map((entry) => entry.entry)).toEqual(["/process-lock", "/lease", "/lanes"]);
  expect(
    budgets.kit
      .filter((entry) => entry.noImports)
      .map((entry) => entry.entry)
      .slice()
      .sort()
  ).toEqual(["/cost", "/cost/prices", "/harness/events", "/redact", "/transcript/usage"]);
});

it("throws when a size-limit entry is missing", () => {
  expect(() => budgetsFromLimits([], collab)).toThrow("No size-limit entry for @rivus/agent-kit/discovery");
});

it("counts public entries and the zero-dependency entries from NO_OUTSIDE_IMPORTS", () => {
  expect(parseBudgetBytes("104 B")).toBe(104);
  expect(factsFromLimits(kit, collab)).toEqual({
    entryCount: 13,
    packageCount: 2,
    zeroDepCount: NO_OUTSIDE_IMPORTS.length
  });
  expect(barFillPercent(1127, 82765)).toBeCloseTo((1127 / 82765) * 100);
  expect(barFillPercent(10, 0)).toBe(0);
  const budgets = budgetsFromLimits(kit, collab);
  expect(largestBudgetBytes(budgets.kit, budgets.collab)).toBe(82765);
  expect(barFillPercent(11102, 82765)).toBeCloseTo((11102 / 82765) * 100);
  expect(groupedKitBudgets(budgets.kit).map((group) => [group.id, group.entries.map((entry) => entry.entry)])).toEqual([
    ["read", ["/discovery", "/sessions", "/transcript", "/transcript/usage", "/cost", "/cost/prices"]],
    ["hook", ["/harness/events", "/harness", "/acp"]],
    ["utilities", ["/redact"]]
  ]);
});
