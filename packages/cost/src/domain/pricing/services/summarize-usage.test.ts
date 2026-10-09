import type { Usage, UsageRecord } from "@rivus/agent-kit-sessions";
import { describe, expect, it } from "vite-plus/test";

import { createPricing } from "../value-objects/pricing-table.js";
import { summarize } from "./summarize-usage.js";

const M = 1_000_000;
const NOW = Date.parse("2026-01-02T12:00:00.000Z");
const pricing = createPricing({
  "claude-opus-4-8": { input: 5, output: 25, cacheWrite: 6.25, cacheWrite1h: 10, cacheRead: 0.5 },
  "gpt-5": { input: 1.25, output: 10, cacheWrite: 1.25, cacheRead: 0.125 }
});

function record(usage: Usage, fields: Partial<UsageRecord> = {}): UsageRecord {
  return {
    agent: "claude-code",
    sessionId: "s1",
    granularity: "request",
    timestamp: NOW - 1000,
    model: "claude-opus-4-8",
    usage,
    source: { file: "/u/me/s1.jsonl", offset: 0, length: 1, line: 1 },
    ...fields
  };
}

// Ported from presence's window summary tests; presence's sources are the kit's agents.
describe("summarize", () => {
  it("totals tokens and cost per agent and overall", () => {
    const summary = summarize([record({ inputTokens: M, outputTokens: 0 })], pricing, { groupBy: ["agent"] });
    expect(summary.groups).toEqual([
      { agent: "claude-code", entries: 1, usage: { inputTokens: M, outputTokens: 0 }, costUsd: 5 }
    ]);
    expect(summary.total).toEqual({ entries: 1, usage: { inputTokens: M, outputTokens: 0 }, costUsd: 5 });
  });

  it("keeps groups in the order of their first record, with the costs the agents reported", () => {
    const records = [
      record({ inputTokens: 3 }, { agent: "pi", model: "x", costUsd: 1.5, costSource: "agent" }),
      record({ inputTokens: 7 }, { agent: "opencode", model: "y", costUsd: 0.25, costSource: "agent" }),
      record({ inputTokens: 1 }, { agent: "pi", model: "x", costUsd: 0, costSource: "agent" })
    ];
    const summary = summarize(records, pricing, { groupBy: ["agent"] });
    expect(summary.groups.map((group) => [group.agent, group.entries, group.usage.inputTokens, group.costUsd])).toEqual(
      [
        ["pi", 2, 4, 1.5],
        ["opencode", 1, 7, 0.25]
      ]
    );
    expect(summary.total.costUsd).toBeCloseTo(1.75, 9);
  });

  it("adds up the total from the groups, as presence adds up its sources", () => {
    const agentCost = (agent: "pi" | "opencode", costUsd: number, inputTokens: number) =>
      record({ inputTokens }, { agent, model: "x", costUsd, costSource: "agent" });
    const records = [agentCost("pi", 0.1, 1), agentCost("opencode", 0.1, 2), agentCost("pi", 0.6, 4)];
    const summary = summarize(records, pricing, { groupBy: ["agent"] });
    const [pi, opencode] = summary.groups;
    // In record order the costs add up to 0.8; by group they add up as presence's do.
    expect(summary.total.costUsd).toBe((pi?.costUsd ?? 0) + (opencode?.costUsd ?? 0));
    expect(summary.total.costUsd).toBe(0.7999999999999999);
    expect(summary.total).toMatchObject({ entries: 3, usage: { inputTokens: 7 } });
    expect(summarize(records, pricing, { groupBy: [] }).total.costUsd).toBe(0.8);
  });

  it("has no groups and no cost without records", () => {
    expect(summarize([], pricing)).toEqual({ total: { entries: 0, usage: {} }, groups: [] });
  });

  it("S73: adds the tokens of unpriced records, and leaves a cost out only where nothing had one", () => {
    const records = [
      record({ inputTokens: M }),
      record({ inputTokens: 5, outputTokens: 1 }, { model: "mystery-model" }),
      record({ inputTokens: 2 }, { model: undefined })
    ];
    const summary = summarize(records, pricing);
    expect(summary.total).toEqual({ entries: 3, usage: { inputTokens: M + 7, outputTokens: 1 }, costUsd: 5 });
    expect(summary.groups.map((group) => [group.model, group.costUsd])).toEqual([
      ["claude-opus-4-8", 5],
      ["mystery-model", undefined],
      [undefined, undefined]
    ]);
    expect(summary.groups[2]).not.toHaveProperty("model");
  });

  it("counts only the records in the window, `until` excluded", () => {
    const records = [
      record({ inputTokens: 1 }, { timestamp: NOW - 2 * 24 * 60 * 60 * 1000 }),
      record({ inputTokens: 2 }, { timestamp: NOW - 1000 }),
      record({ inputTokens: 4 }, { timestamp: NOW })
    ];
    const summary = summarize(records, pricing, { window: { since: NOW - 24 * 60 * 60 * 1000, until: NOW } });
    expect(summary.total).toMatchObject({ entries: 1, usage: { inputTokens: 2 } });
  });

  it("groups by agent and model unless told otherwise, and only totals with an empty grouping", () => {
    const records = [
      record({ inputTokens: 1 }),
      record({ inputTokens: 2 }, { agent: "codex", model: "gpt-5" }),
      record({ inputTokens: 4 }, { agent: "pi", model: "gpt-5", costUsd: 0.5, costSource: "agent" })
    ];
    expect(summarize(records, pricing).groups.map((group) => [group.agent, group.model])).toEqual([
      ["claude-code", "claude-opus-4-8"],
      ["codex", "gpt-5"],
      ["pi", "gpt-5"]
    ]);
    const byModel = summarize(records, pricing, { groupBy: ["model"] }).groups;
    expect(byModel.map((group) => [group.model, group.entries, group.usage.inputTokens])).toEqual([
      ["claude-opus-4-8", 1, 1],
      ["gpt-5", 2, 6]
    ]);
    expect(byModel[1]).not.toHaveProperty("agent");
    expect(summarize(records, pricing, { groupBy: [] })).toMatchObject({ total: { entries: 3 }, groups: [] });
  });

  it("S28: counts a turn split by model once, with each model's share in that model's group", () => {
    const turn = record(
      { inputTokens: 3 * M, outputTokens: 2 * M, cacheReadTokens: M },
      {
        agent: "grok",
        granularity: "turn",
        modelCalls: 3,
        model: "claude-opus-4-8",
        usageByModel: {
          "claude-opus-4-8": { usage: { inputTokens: 2 * M, outputTokens: M, cacheReadTokens: M }, modelCalls: 2 },
          "gpt-5": { usage: { inputTokens: M, outputTokens: M }, modelCalls: 1 }
        }
      }
    );
    const summary = summarize([turn], pricing);
    expect(summary.total).toMatchObject({
      entries: 1,
      usage: { inputTokens: 3 * M, outputTokens: 2 * M, cacheReadTokens: M }
    });
    expect(summary.total.costUsd).toBeCloseTo(5 + 25 + 0.5 + 1.25 + 10, 6);
    expect(summary.groups.map((group) => [group.model, group.entries, group.usage.inputTokens])).toEqual([
      ["claude-opus-4-8", 1, 2 * M],
      ["gpt-5", 1, M]
    ]);
    // Grouped by agent only, the turn is still one entry.
    expect(summarize([turn], pricing, { groupBy: ["agent"] }).groups).toMatchObject([{ agent: "grok", entries: 1 }]);
  });
});
