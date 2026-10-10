import type { CodingAgentId } from "@rivus/agent-kit-catalog";
import type { Usage, UsageRecord } from "@rivus/agent-kit-sessions";

import type { Pricing } from "../value-objects/pricing-table.js";
import type { UsageGroup, UsageGroupKey, UsageSummary } from "../value-objects/usage-summary.js";
import { portionsOf } from "./price-usage.js";

export interface SummarizeOptions {
  /** Counts only the records from `since` (included) to `until` (excluded), such as a `calendarWindow`. */
  readonly window?: { readonly since?: number; readonly until?: number };
  /** What the groups are keyed by: agent and model unless given; an empty list leaves only the total. */
  readonly groupBy?: readonly UsageGroupKey[];
}

/** Every count of `Usage`; `satisfies` fails to compile until a count added to `Usage` is listed here. */
const COUNTS = Object.keys({
  inputTokens: true,
  outputTokens: true,
  totalTokens: true,
  cacheReadTokens: true,
  cacheWriteTokens: true,
  cacheWrite1hTokens: true,
  reasoningTokens: true
} satisfies Record<keyof Usage, true>) as (keyof Usage)[];

/**
 * sessions' `addUsage`, which cost cannot call because it takes only types from sessions: a count absent from both
 * sides stays absent, one absent from one side counts as 0 there.
 */
function addUsage(left: Usage, right: Usage): Usage {
  const sum: Usage = {};
  for (const key of COUNTS) {
    const a = left[key];
    const b = right[key];
    if (a !== undefined || b !== undefined) {
      sum[key] = (a ?? 0) + (b ?? 0);
    }
  }
  return sum;
}

function add(into: Tally, usage: Usage, costUsd: number | undefined): void {
  into.usage = addUsage(into.usage, usage);
  if (costUsd !== undefined) {
    into.costUsd = (into.costUsd ?? 0) + costUsd;
  }
}

function tally(agent?: CodingAgentId, model?: string): Tally {
  return {
    ...(agent === undefined ? {} : { agent }),
    ...(model === undefined ? {} : { model }),
    entries: 0,
    usage: {}
  };
}

function totals({ costUsd, ...rest }: Tally): UsageGroup {
  return {
    ...rest,
    ...(costUsd === undefined ? {} : { costUsd })
  };
}

/**
 * Totals of `records` in the window, as presence summarizes its sources: tokens, how many records contributed, and
 * the sum of the costs that `costOf`'s rules know, per group. A group's cost is absent when none of its records had a
 * known cost; records without one add their tokens but no dollars. The total adds up the groups, as presence adds up
 * its sources, and counts each record once. A record split by model (`usageByModel`) adds its split, model by model,
 * and not its aggregate as well, so a turn of several models counts its tokens once and each model's tokens land in
 * that model's group.
 */
export function summarize(
  records: Iterable<UsageRecord>,
  pricing: Pricing,
  options: SummarizeOptions = {}
): UsageSummary {
  const since = options.window?.since ?? Number.NEGATIVE_INFINITY;
  const until = options.window?.until ?? Number.POSITIVE_INFINITY;
  const groupBy = options.groupBy ?? ["agent", "model"];
  const byAgent = groupBy.includes("agent");
  const byModel = groupBy.includes("model");
  // Without a key, every portion falls into one group, which is then the total.
  const groups = new Map<string, Tally>();
  let entries = 0;
  for (const record of records) {
    if (record.timestamp < since || record.timestamp >= until) {
      continue;
    }
    entries += 1;
    const touched = new Set<Tally>();
    for (const portion of portionsOf(record, pricing)) {
      const agent = byAgent ? record.agent : undefined;
      const model = byModel ? portion.model : undefined;
      const key = JSON.stringify([agent ?? null, model ?? null]);
      const group = groups.get(key) ?? tally(agent, model);
      groups.set(key, group);
      add(group, portion.usage, portion.cost?.costUsd);
      if (!touched.has(group)) {
        touched.add(group);
        group.entries += 1;
      }
    }
  }
  const total = tally();
  for (const group of groups.values()) {
    add(total, group.usage, group.costUsd);
  }
  total.entries = entries;
  return { total: totals(total), groups: byAgent || byModel ? [...groups.values()].map(totals) : [] };
}

interface Tally {
  readonly agent?: CodingAgentId;
  readonly model?: string;
  entries: number;
  usage: Usage;
  costUsd?: number;
}
