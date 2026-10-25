import type { Usage, UsageRecord } from "@rivus/agent-kit-sessions/public";
import { describe, expect, it } from "vite-plus/test";

import { createPricing, type PriceOverrides, type PricingTable } from "../value-objects/pricing-table.js";
import { costOf } from "./price-usage.js";
import { summarize } from "./summarize-usage.js";

// Ported from presence's cost and ccusage parity tests. presence's records hold input without cache; these hold the
// kit's input, which includes cache reads and writes, so each case adds them back and expects presence's dollars.
const SNAPSHOT: PricingTable = {
  "claude-opus-4-8": { input: 5, output: 25, cacheWrite: 6.25, cacheWrite1h: 10, cacheRead: 0.5 },
  "claude-sonnet-5": { input: 2, output: 10, cacheWrite: 2.5, cacheWrite1h: 4, cacheRead: 0.2 },
  "gpt-5.5": { input: 5, output: 30, cacheWrite: 5, cacheRead: 0.5 },
  "gpt-5.6-sol": { input: 5, output: 30, cacheWrite: 6.25, cacheRead: 0.5 },
  "gpt-6-sol": {
    input: 5,
    output: 30,
    cacheWrite: 6.25,
    cacheRead: 0.5,
    longContext: { thresholdTokens: 272_000, input: 10, output: 45, cacheRead: 1, cacheWrite: 12.5 }
  },
  "gpt-6-terra": {
    input: 5,
    output: 30,
    cacheWrite: 6.25,
    cacheRead: 0.5,
    longContext: { thresholdTokens: 272_000, input: 10, output: 45 }
  },
  "claude-haiku-5-5": {
    input: 1,
    output: 5,
    cacheWrite: 1.25,
    cacheWrite1h: 2,
    cacheRead: 0.1,
    longContext: { thresholdTokens: 100_000, input: 2, output: 7.5, cacheRead: 0.2, cacheWrite: 2.5, cacheWrite1h: 4 }
  }
};
const ALIASES: PricingTable = { "gpt-5": { input: 1.25, output: 10, cacheWrite: 1.25, cacheRead: 0.125 } };
const pricing = (overrides?: PriceOverrides) =>
  createPricing(SNAPSHOT, { fallback: ALIASES, ...(overrides ? { overrides } : {}) });

const M = 1_000_000;

function record(usage: Usage, fields: Partial<UsageRecord> = {}): UsageRecord {
  return {
    agent: "claude-code",
    sessionId: "s1",
    granularity: "request",
    timestamp: 0,
    model: "claude-opus-4-8",
    usage,
    source: { file: "/u/me/s1.jsonl", offset: 0, length: 1, line: 1 },
    ...fields
  };
}

describe("costOf", () => {
  it("uses the cost the record carries, also when it is 0", () => {
    const pi = { agent: "pi", model: "glm-5.1", costSource: "agent" } as const;
    expect(costOf(record({}, { ...pi, costUsd: 0 }), pricing())).toEqual({ costUsd: 0, costSource: "agent" });
    expect(costOf(record({}, { ...pi, costUsd: 1.23 }), pricing())).toEqual({ costUsd: 1.23, costSource: "agent" });
  });

  it("prices each count at the table's price when the record carries no cost", () => {
    const cost = costOf(record({ inputTokens: 2 * M, outputTokens: M, cacheReadTokens: M }), pricing());
    // claude-opus-4-8: 5 input + 25 output + 0.5 cache read per million tokens
    expect(cost?.costUsd).toBeCloseTo(5 + 25 + 0.5, 5);
    expect(cost?.costSource).toBe("pricing-table");
  });

  it("prices one-hour cache writes at their own price, and the rest of the cache writes at the 5-minute price", () => {
    const usage = { inputTokens: M, cacheWriteTokens: M, cacheWrite1hTokens: M };
    expect(costOf(record(usage, { model: "claude-sonnet-5" }), pricing())?.costUsd).toBeCloseTo(4, 6);
    const mixed = { inputTokens: 2 * M, cacheWriteTokens: 2 * M, cacheWrite1hTokens: M };
    expect(costOf(record(mixed, { model: "claude-sonnet-5" }), pricing())?.costUsd).toBeCloseTo(4 + 2.5, 6);
    // Without a one-hour price, one-hour writes cost the 5-minute price.
    expect(costOf(record(usage, { model: "gpt-5.6-sol" }), pricing())?.costUsd).toBeCloseTo(6.25, 6);
  });

  it("S29: applies the pricing multiplier to computed cost, not to the cost the agent reported", () => {
    const usage = { inputTokens: 2 * M, outputTokens: M, cacheReadTokens: M };
    const computed = record(usage, { agent: "codex", model: "gpt-5.6-sol", pricingMultiplier: 2 });
    expect(costOf(computed, pricing())?.costUsd).toBeCloseTo((5 + 30 + 0.5) * 2, 6);
    const reported = record(usage, { model: "gpt-5.6-sol", pricingMultiplier: 2, costUsd: 0.25, costSource: "agent" });
    expect(costOf(reported, pricing())).toEqual({ costUsd: 0.25, costSource: "agent" });
  });

  it("has no cost for an unpriced model or a record without a model, and charges nothing for a missing count", () => {
    expect(costOf(record({ inputTokens: M }, { model: "mystery-model" }), pricing())).toBeUndefined();
    expect(costOf(record({ inputTokens: M }, { model: undefined }), pricing())).toBeUndefined();
    expect(costOf(record({ outputTokens: M }), pricing())?.costUsd).toBeCloseTo(25, 6);
    expect(costOf(record({ cacheReadTokens: M }), pricing())?.costUsd).toBeCloseTo(0.5, 6);
    expect(costOf(record({}), pricing())).toEqual({ costUsd: 0, costSource: "pricing-table" });
  });

  it("clamps counts that break the subset rules instead of charging them twice or below 0", () => {
    const sonnet = (usage: Usage) => costOf(record(usage, { model: "claude-sonnet-5" }), pricing())?.costUsd;
    // One-hour writes beyond the cache writes: only the cache writes are charged, all at the one-hour price.
    expect(sonnet({ inputTokens: M, cacheWriteTokens: M, cacheWrite1hTokens: 2 * M })).toBeCloseTo(4, 6);
    // One-hour writes without a cache write count: nothing is charged for them, and the input stays input.
    expect(sonnet({ inputTokens: M, cacheWrite1hTokens: M })).toBeCloseTo(2, 6);
    // Cache counts larger than the input: input without cache is 0, not negative.
    expect(sonnet({ inputTokens: M, cacheReadTokens: 2 * M })).toBeCloseTo(0.4, 6);
    expect(sonnet({ cacheReadTokens: M, cacheWriteTokens: M })).toBeCloseTo(0.2 + 2.5, 6);
  });

  it("charges at the table's price without a multiplier, and nothing for a negative one", () => {
    const usage = { inputTokens: M, outputTokens: M };
    const at = (pricingMultiplier?: number) =>
      costOf(record(usage, pricingMultiplier === undefined ? {} : { pricingMultiplier }), pricing());
    expect(at()?.costUsd).toBe(at(1)?.costUsd);
    expect(at()?.costUsd).toBeCloseTo(30, 6);
    expect(at(-1)).toEqual({ costUsd: 0, costSource: "pricing-table" });
  });

  describe("S71: a record split by model", () => {
    const turn = (fields: Partial<UsageRecord>) =>
      record(
        { inputTokens: 3 * M, outputTokens: 2 * M },
        {
          agent: "grok",
          granularity: "turn",
          modelCalls: 3,
          model: "claude-opus-4-8",
          usageByModel: {
            "claude-opus-4-8": { usage: { inputTokens: 2 * M, outputTokens: M }, modelCalls: 2 },
            "claude-sonnet-5": { usage: { inputTokens: M, outputTokens: M }, modelCalls: 1 }
          },
          ...fields
        }
      );

    it("prices each model's share at its own price instead of the aggregate at the main model's", () => {
      const cost = costOf(turn({}), pricing());
      expect(cost?.costUsd).toBeCloseTo(2 * 5 + 25 + (2 + 10), 6);
      expect(cost?.costSource).toBe("pricing-table");
    });

    it("has no cost when one of the models is unpriced", () => {
      const split = { ...turn({}).usageByModel, mystery: { usage: { inputTokens: 1 } } };
      expect(costOf(turn({ usageByModel: split }), pricing())).toBeUndefined();
    });

    it("keeps the cost the agent reported for the turn, and the per-model costs it reported", () => {
      expect(costOf(turn({ costUsd: 0.5, costSource: "agent" }), pricing())).toEqual({
        costUsd: 0.5,
        costSource: "agent"
      });
      const split = {
        "claude-opus-4-8": { usage: { inputTokens: 2 * M }, costUsd: 0.25, costSource: "agent" as const },
        "claude-sonnet-5": { usage: { inputTokens: M }, costUsd: 0.125, costSource: "agent" as const }
      };
      expect(costOf(turn({ usageByModel: split }), pricing())).toEqual({ costUsd: 0.375, costSource: "agent" });
    });

    it("takes the models' amounts over the turn's in costOf and summarize alike", () => {
      const split = {
        "claude-opus-4-8": { usage: { inputTokens: 2 * M }, costUsd: 0.25, costSource: "agent" as const },
        "claude-sonnet-5": { usage: { inputTokens: M }, costUsd: 0.125, costSource: "agent" as const }
      };
      const both = turn({ costUsd: 0.5, costSource: "agent", usageByModel: split });
      expect(costOf(both, pricing())).toEqual({ costUsd: 0.375, costSource: "agent" });
      const summary = summarize([both], pricing(), { groupBy: ["model"] });
      expect(summary.total.costUsd).toBe(0.375);
      expect(summary.groups.map((group) => [group.model, group.costUsd])).toEqual([
        ["claude-opus-4-8", 0.25],
        ["claude-sonnet-5", 0.125]
      ]);
    });

    it("keeps the split of a record that a spread of its computed cost priced", () => {
      const plain = turn({});
      const cost = costOf(plain, pricing());
      expect(cost?.costSource).toBe("pricing-table");
      const priced: UsageRecord = { ...plain, ...cost };
      expect(costOf(priced, pricing())).toEqual(cost);
      expect(summarize([priced], pricing())).toEqual(summarize([plain], pricing()));
      expect(summarize([priced], pricing()).groups).toHaveLength(2);
    });
  });
});

describe("ccusage parity of the per-bucket formula", () => {
  // Fixed prices that tell a mis-wired bucket apart.
  const prices = pricing({ "gpt-5": { input: 2, output: 8, cacheWrite: 2.5, cacheRead: 0.2 } });
  const codex = (usage: Usage, fields: Partial<UsageRecord> = {}) =>
    record(usage, { agent: "codex", model: "gpt-5", ...fields });

  it("prices each bucket on its own", () => {
    const usage = { inputTokens: 3 * M, outputTokens: M, cacheWriteTokens: M, cacheReadTokens: M };
    expect(costOf(codex(usage), prices)?.costUsd).toBeCloseTo(2 + 8 + 2.5 + 0.2, 6);
  });

  it("does not charge cached tokens at the input price as well", () => {
    // A prompt of 100k tokens of which 80k were cached: 20k at the input price, 80k at the cache read price.
    const cost = costOf(codex({ inputTokens: 100_000, cacheReadTokens: 80_000, outputTokens: 1000 }), prices);
    expect(cost?.costUsd).toBeCloseTo((20_000 * 2 + 80_000 * 0.2 + 1000 * 8) / M, 9);
  });

  it("trusts a cost from the log as it is", () => {
    expect(costOf(codex({}, { agent: "pi", costUsd: 3.5 }), prices)?.costUsd).toBe(3.5);
    expect(costOf(codex({}, { agent: "opencode", costUsd: 0 }), prices)?.costUsd).toBe(0);
  });

  it("prices models the table has, and only those", () => {
    expect(costOf(codex({ inputTokens: M }, { model: "gpt-5.5" }), pricing())?.costUsd).toBeCloseTo(5, 6);
    expect(costOf(codex({ inputTokens: M }, { model: "openrouter-3o" }), pricing())).toBeUndefined();
    const override = pricing({ "openrouter-3o": { input: 15, output: 75, cacheWrite: 18.75, cacheRead: 1.5 } });
    expect(costOf(codex({ inputTokens: M }, { model: "openrouter-3o" }), override)?.costUsd).toBeCloseTo(15, 6);
  });
});

describe("S213: a model's long-context tier", () => {
  const table = pricing();
  // gpt-6-sol: base 5/30/6.25/0.5, tier past 272k input 10/45/1/12.5.
  const above = { inputTokens: 300_000, outputTokens: 10_000, cacheReadTokens: 200_000 };
  const at = (usage: Usage, fields: Partial<UsageRecord> = {}) =>
    costOf(record(usage, { model: "gpt-6-sol", ...fields }), table)?.costUsd;

  it("prices a request past the threshold whole at the tier's rates, and one at or below it at the base rates", () => {
    // Past: (300_000 − 200_000)×10 + 200_000×1 + 10_000×45 = 1_650_000, so 1.65 (the base rates would give 0.9).
    expect(at(above)).toBeCloseTo(1.65, 9);
    // At exactly 272_000 the base rates still hold: 272_000×5 = 1_360_000, so 1.36.
    expect(at({ inputTokens: 272_000 })).toBeCloseTo(1.36, 9);
    // Below: 100_000×5 = 500_000, so 0.5.
    expect(at({ inputTokens: 100_000 })).toBeCloseTo(0.5, 9);
    // A model without a tier keeps the base rates however long its input: 1_000_000×5 = 5.
    expect(costOf(record({ inputTokens: M }, { model: "claude-opus-4-8" }), table)?.costUsd).toBeCloseTo(5, 9);
  });

  it("keeps the base price for a rate the tier lacks", () => {
    // gpt-6-terra's tier has no cache rates: 100_000×10 + 200_000×0.5 + 10_000×45 = 1_550_000, so 1.55.
    expect(costOf(record(above, { model: "gpt-6-terra" }), table)?.costUsd).toBeCloseTo(1.55, 9);
  });

  it("prices one-hour cache writes above the threshold by the tier, then the base, then the tier's five-minute price", () => {
    // claude-haiku-5-5 past 100k input, every write a one-hour write, at the tier's 4: 150_000×4 = 0.6.
    const hour = { inputTokens: 150_000, cacheWriteTokens: 150_000, cacheWrite1hTokens: 150_000 };
    expect(costOf(record(hour, { model: "claude-haiku-5-5" }), table)?.costUsd).toBeCloseTo(0.6, 9);
    // gpt-6-sol's tier has no one-hour price and neither has the base: the tier's 12.5 applies. 300_000×12.5 = 3.75.
    const past = { inputTokens: 300_000, cacheWriteTokens: 300_000, cacheWrite1hTokens: 300_000 };
    expect(at(past)).toBeCloseTo(3.75, 9);
    // A full override that says nothing about the tier keeps it, and its one-hour price of 10 fills in: 300_000×10 = 3.
    const override = pricing({
      "gpt-6-sol": { input: 5, output: 30, cacheWrite: 6.25, cacheWrite1h: 10, cacheRead: 0.5 }
    });
    expect(costOf(record(past, { model: "gpt-6-sol" }), override)?.costUsd).toBeCloseTo(3, 9);
  });

  it("multiplies the tiered amount and lets the agent's own amount win, as at the base rates", () => {
    expect(at(above, { pricingMultiplier: 2 })).toBeCloseTo(3.3, 9);
    expect(at(above, { costUsd: 0.25, costSource: "agent" })).toBe(0.25);
  });

  it("judges each model of a split by its own usage, and summarize keeps priceRecord's costs", () => {
    const turn = record(
      { inputTokens: 600_000 },
      {
        agent: "codex",
        granularity: "turn",
        modelCalls: 2,
        model: "gpt-6-sol",
        usageByModel: {
          "gpt-6-sol": { usage: { inputTokens: 300_000 }, modelCalls: 1 },
          "claude-sonnet-5": { usage: { inputTokens: 300_000 }, modelCalls: 1 }
        }
      }
    );
    // Past the threshold: 300_000×10 = 3. No tier: 300_000×2 = 0.6.
    expect(costOf(turn, table)).toEqual({ costUsd: 3.6, costSource: "pricing-table" });
    const summary = summarize([turn], table, { groupBy: ["model"] });
    expect(summary.groups.map((group) => [group.model, group.costUsd])).toEqual([
      ["gpt-6-sol", 3],
      ["claude-sonnet-5", 0.6]
    ]);
    expect(summary.total.costUsd).toBe(3.6);
    const single = record(above, { model: "gpt-6-sol" });
    expect(summarize([single], table).total.costUsd).toBe(costOf(single, table)?.costUsd);
  });
});
