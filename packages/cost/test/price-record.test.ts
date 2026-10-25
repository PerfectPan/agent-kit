import type { Usage, UsageRecord } from "@rivus/agent-kit-sessions/public";
import { describe, expect, it } from "vite-plus/test";

import { createPricing, priceRecord, summarize } from "../src/public.js";

const M = 1_000_000;
const pricing = createPricing({
  "claude-opus-4-8": { input: 5, output: 25, cacheWrite: 6.25, cacheWrite1h: 10, cacheRead: 0.5 },
  "gpt-5": { input: 1.25, output: 10, cacheWrite: 1.25, cacheRead: 0.125 }
});

function record(usage: Usage, fields: Partial<UsageRecord> = {}): UsageRecord {
  return {
    agent: "claude-code",
    sessionId: "s1",
    granularity: "request",
    timestamp: Date.parse("2026-01-02T12:00:00.000Z"),
    model: "claude-opus-4-8",
    usage,
    source: { file: "/u/me/s1.jsonl", offset: 0, length: 1, line: 1 },
    ...fields
  };
}

// 1M input without cache, 1M output, 1M five-minute and 1M one-hour cache writes, 1M cache reads.
const cached = record({
  inputTokens: 4 * M,
  outputTokens: M,
  cacheReadTokens: M,
  cacheWriteTokens: 2 * M,
  cacheWrite1hTokens: M
});
const priority = record({ inputTokens: M, outputTokens: M }, { agent: "codex", model: "gpt-5", pricingMultiplier: 2 });
const turn = record(
  { inputTokens: 4 * M, outputTokens: M },
  {
    agent: "grok",
    granularity: "turn",
    modelCalls: 3,
    pricingMultiplier: 2,
    usageByModel: {
      "claude-opus-4-8": { usage: { inputTokens: 2 * M, outputTokens: M }, modelCalls: 2 },
      "gpt-5": { usage: { inputTokens: M }, modelCalls: 1 },
      mystery: { usage: { inputTokens: M } }
    }
  }
);
const logged = record({ inputTokens: 3 }, { agent: "pi", model: "mystery", costUsd: 0.5, costSource: "agent" });
const unpriced = record({ inputTokens: 7 }, { agent: "opencode", model: "mystery" });
const loggedTurn = record(
  { inputTokens: 3 * M },
  {
    agent: "grok",
    granularity: "turn",
    costUsd: 0.5,
    costSource: "agent",
    usageByModel: {
      "claude-opus-4-8": { usage: { inputTokens: 2 * M }, costUsd: 0.25, costSource: "agent" },
      "gpt-5": { usage: { inputTokens: M }, costUsd: 0.125, costSource: "agent" }
    }
  }
);
const nameless = record({ inputTokens: M }, { model: undefined });

describe("priceRecord", () => {
  it("prices a record as one part, one-hour cache writes at their own price", () => {
    expect(priceRecord(cached, pricing)).toEqual({
      parts: [{ model: "claude-opus-4-8", usage: cached.usage, cost: { costUsd: 46.75, costSource: "pricing-table" } }]
    });
    expect(priceRecord(priority, pricing).parts[0]?.cost).toEqual({ costUsd: 22.5, costSource: "pricing-table" });
  });

  it("prices a split record per model, with each share's model calls and the record's multiplier", () => {
    expect(priceRecord(turn, pricing)).toEqual({
      parts: [
        {
          model: "claude-opus-4-8",
          usage: { inputTokens: 2 * M, outputTokens: M },
          modelCalls: 2,
          cost: { costUsd: 70, costSource: "pricing-table" }
        },
        {
          model: "gpt-5",
          usage: { inputTokens: M },
          modelCalls: 1,
          cost: { costUsd: 2.5, costSource: "pricing-table" }
        },
        { model: "mystery", usage: { inputTokens: M } }
      ]
    });
  });

  it("keeps the amounts the agent logged, without the multiplier, also for models the pricing lacks", () => {
    expect(priceRecord({ ...logged, pricingMultiplier: 2 }, pricing).parts).toEqual([
      { model: "mystery", usage: logged.usage, cost: { costUsd: 0.5, costSource: "agent" } }
    ]);
    expect(priceRecord(loggedTurn, pricing).parts.map((part) => [part.model, part.cost])).toEqual([
      ["claude-opus-4-8", { costUsd: 0.25, costSource: "agent" }],
      ["gpt-5", { costUsd: 0.125, costSource: "agent" }]
    ]);
  });

  it("leaves a part that nothing prices without a cost, not a cost of 0", () => {
    expect(priceRecord(unpriced, pricing).parts).toEqual([{ model: "mystery", usage: unpriced.usage }]);
    expect(priceRecord(nameless, pricing).parts).toEqual([{ usage: nameless.usage }]);
  });

  it("adds up per agent and model to the groups of summarize", () => {
    const records = [cached, priority, turn, logged, unpriced, loggedTurn, nameless, record({ inputTokens: M })];
    const groups = new Map<string, readonly [string, string | undefined, number | undefined]>();
    for (const item of records) {
      for (const { model, cost } of priceRecord(item, pricing).parts) {
        const key = JSON.stringify([item.agent, model ?? null]);
        const [, , costUsd] = groups.get(key) ?? [item.agent, model, undefined];
        groups.set(key, [item.agent, model, cost === undefined ? costUsd : (costUsd ?? 0) + cost.costUsd]);
      }
    }
    const summary = summarize(records, pricing);
    expect(summary.groups.map((group) => [group.agent, group.model, group.costUsd])).toEqual([...groups.values()]);
    expect(summary.groups).toHaveLength(8);
  });
});
