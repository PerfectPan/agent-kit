import type { CodingAgentId } from "@rivus/agent-kit-catalog";
import { calendarWindow, costOf, createPricing, type Price, summarize } from "@rivus/agent-kit-cost";
import { decodeUsage, isUsageRecord, noCacheInputTokens, type UsageRecord } from "@rivus/agent-kit-sessions";
import { describe, expect, it } from "vite-plus/test";

import { createMemoryPlatform } from "../src/memory-platform.js";
import { readUsageHome } from "./support.js";

// The usage fixtures, decoded by /transcript/usage and priced by /cost with a synthetic table.

const platform = createMemoryPlatform({ files: await readUsageHome("/u/me"), home: "/u/me" });

const pricing = createPricing({
  "claude-test": { input: 3, output: 15, cacheWrite: 3.75, cacheWrite1h: 6, cacheRead: 0.3 },
  "gpt-test": { input: 1.25, output: 10, cacheWrite: 1.25, cacheRead: 0.125 },
  "gemini-test": { input: 0.5, output: 3, cacheWrite: 0.5, cacheRead: 0.05 },
  "grok-main": { input: 2, output: 10, cacheWrite: 2, cacheRead: 0.5 }
});

const SOURCES: readonly (readonly [CodingAgentId, string])[] = [
  ["claude-code", ".claude/projects/-u-me-work/s-usage.jsonl"],
  ["codex", ".codex/sessions/2026/01/01/rollout-2026-01-01T00-00-00-cx-totals.jsonl"],
  ["gemini-cli", ".gemini/tmp/projhash/chats/session-2026-01-01T00-00-gm1.jsonl"],
  ["pi", ".pi/agent/sessions/--u-me-work--/2026-01-01T00-00-00-000Z_pi-1.jsonl"],
  ["opencode", ".local/share/opencode/storage/message/ses_legacy"],
  ["grok", ".grok/sessions/%2Fu%2Fme%2Fwork/gk-usage/updates.jsonl"]
];

async function decode(agent: CodingAgentId, path: string): Promise<UsageRecord[]> {
  const records: UsageRecord[] = [];
  for await (const item of decodeUsage(platform, agent, { path: `/u/me/${path}` }, { final: true })) {
    if (!isUsageRecord(item)) {
      throw new Error(`${path}: ${JSON.stringify(item.error)}`);
    }
    records.push(item);
  }
  return records;
}

const records = (await Promise.all(SOURCES.map(([agent, path]) => decode(agent, path)))).flat();
const byAgent = (agent: CodingAgentId) => records.filter((record) => record.agent === agent);

/**
 * presence's cost of a record, as its pricing code computes it on the four buckets it keeps: input without cache,
 * cache reads, cache writes with their one-hour part, and output. A recorded cost wins; an unknown price is `null`.
 */
function presenceCost(record: UsageRecord, price: Price | undefined): number | null {
  if (record.costUsd !== undefined) {
    return record.costUsd;
  }
  if (price === undefined) {
    return null;
  }
  const usage = record.usage;
  const bucket = {
    inputTokens: noCacheInputTokens(usage) ?? 0,
    outputTokens: usage.outputTokens ?? 0,
    cacheWriteTokens: usage.cacheWriteTokens ?? 0,
    cacheWrite1hTokens: usage.cacheWrite1hTokens,
    cacheReadTokens: usage.cacheReadTokens ?? 0
  };
  const cacheWrite1hTokens = Math.min(bucket.cacheWriteTokens, Math.max(0, bucket.cacheWrite1hTokens ?? 0));
  const cacheWrite5mTokens = bucket.cacheWriteTokens - cacheWrite1hTokens;
  const bucketCost =
    (bucket.inputTokens * price.input +
      bucket.outputTokens * price.output +
      cacheWrite5mTokens * price.cacheWrite +
      cacheWrite1hTokens * (price.cacheWrite1h ?? price.cacheWrite) +
      bucket.cacheReadTokens * price.cacheRead) /
    1_000_000;
  return bucketCost * Math.max(0, record.pricingMultiplier ?? 1);
}

describe("pricing decoded usage", () => {
  it("gives presence's dollars for every record presence has, to the last bit", () => {
    // presence has no records split by model, such as Grok's turns; those are priced per model below.
    const unsplit = records.filter((record) => record.usageByModel === undefined);
    expect(unsplit).toHaveLength(records.length - 1);
    for (const record of unsplit) {
      const price = record.model === undefined ? undefined : pricing.priceOf(record.model);
      expect(costOf(record, pricing)?.costUsd ?? null, `${record.agent} ${record.requestId ?? record.responseId}`).toBe(
        presenceCost(record, price)
      );
    }
  });

  it("prices Claude Code's one-hour cache writes at the one-hour price, and leaves an unpriced model without cost", () => {
    const request = (id: string) =>
      byAgent("claude-code").find((record) => (record.requestId ?? record.responseId) === id);
    const [first, gateway, oneHour, sidechain] = ["req-1", "msg-gw", "req-2", "req-side"].map(request);
    // 10 input, 20 output, 2 five-minute and 3 one-hour cache writes, 100 cache reads.
    expect(costOf(first!, pricing)?.costUsd).toBeCloseTo((10 * 3 + 20 * 15 + 2 * 3.75 + 3 * 6 + 100 * 0.3) / 1e6, 15);
    expect(costOf(oneHour!, pricing)?.costUsd).toBeCloseTo((2103 * 6) / 1e6, 15);
    expect(costOf(sidechain!, pricing)?.costUsd).toBeCloseTo((4 * 3 + 15) / 1e6, 15);
    expect(costOf(gateway!, pricing)).toBeUndefined();
  });

  it("doubles the cost of Codex requests on the priority tier", () => {
    const costs = byAgent("codex").map((record) => costOf(record, pricing)?.costUsd);
    expect(costs[0]).toBeCloseTo(((800 * 1.25 + 50 * 10 + 200 * 0.125) / 1e6) * 2, 15);
    expect(costs[3]).toBeCloseTo((200 * 1.25 + 9 * 10 + 100 * 0.125) / 1e6, 15);
  });

  it("keeps the costs Pi, opencode and Grok logged, also for models the table lacks", () => {
    expect(byAgent("pi").map((record) => costOf(record, pricing))).toEqual([
      { costUsd: 0, costSource: "agent" },
      { costUsd: 0.5, costSource: "agent" }
    ]);
    expect(byAgent("opencode").map((record) => costOf(record, pricing)?.costUsd)).toEqual([0.01, 0]);
    // Grok logged the turn's cost and each model's; the models' amounts are used, and they add up to the turn's.
    expect(costOf(byAgent("grok")[0]!, pricing)).toEqual({
      costUsd: 0.12 + 0.003456789,
      costSource: "agent"
    });
    expect(costOf(byAgent("grok")[0]!, pricing)?.costUsd).toBeCloseTo(0.123456789, 12);
  });

  it("summarizes a calendar window per agent and model, with tokens in the kit's convention", () => {
    const window = calendarWindow(2, {
      now: Date.parse("2026-01-02T12:00:00.000Z"),
      timeZone: "UTC"
    });
    const summary = summarize(records, pricing, { window });
    // A Claude Code and a Gemini CLI request from December are outside the window.
    expect(records).toHaveLength(17);
    expect(summary.total.entries).toBe(15);
    expect(summary.groups.map((group) => [group.agent, group.model, group.entries, group.costUsd?.toFixed(9)])).toEqual(
      [
        ["claude-code", "claude-test", 3, "0.013030500"],
        ["claude-code", "gateway-model", 1, undefined],
        ["codex", "gpt-test", 4, "0.009452500"],
        ["gemini-cli", "gemini-test", 2, "0.001730000"],
        ["pi", "model-test", 2, "0.500000000"],
        ["opencode", "model-test", 2, "0.010000000"],
        ["grok", "grok-main", 1, "0.120000000"],
        ["grok", "grok-mini", 1, "0.003456789"]
      ]
    );
    expect(summary.groups[0]?.usage).toEqual({
      inputTokens: 115 + 2103 + 4,
      outputTokens: 20 + 0 + 1,
      totalTokens: 135 + 2103 + 5,
      cacheReadTokens: 100,
      cacheWriteTokens: 5 + 2103,
      cacheWrite1hTokens: 3 + 2103,
      reasoningTokens: 4
    });
    expect(summary.groups.at(-1)?.usage).toMatchObject({
      inputTokens: 10000,
      cacheReadTokens: 5000
    });
    expect(summary.total.costUsd).toBeCloseTo(0.0130305 + 0.0094525 + 0.00173 + 0.5 + 0.01 + 0.123456789, 12);
  });
});
