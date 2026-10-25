import type { UsageRecord } from "@rivus/agent-kit-sessions/public";
import { describe, expect, it } from "vite-plus/test";

import snapshot from "../src/domain/pricing/adapters/litellm-snapshot.json" with { type: "json" };
import { litellmPrices, litellmPricesVersion } from "../src/prices.js";
import { createPricing, fromLiteLLM, type Price, priceRecord } from "../src/public.js";

const M = 1_000_000;
const pricing = createPricing(litellmPrices);

// The real model ids in the kit's tests and fixtures, with presence's snapshot list, that LiteLLM prices; spellings
// differ in case and in dated or Codex suffixes as the agents record them.
const CLAUDE = [
  "claude-opus-4-8",
  "claude-opus-4-8-20260101",
  "CLAUDE-OPUS-4-8",
  "claude-opus-5-5",
  "claude-sonnet-5",
  "claude-sonnet-4-6",
  "claude-sonnet-4-5",
  "claude-haiku-4-5",
  "claude-fable-5"
];
const OTHERS = [
  "gpt-5",
  "gpt-5-codex",
  "gpt-5.1-codex",
  "gpt-5.4",
  "gpt-5.5",
  "GPT-5.5",
  "gpt-5.5-codex",
  "gpt-5.6-sol",
  "gemini-3-flash-preview",
  "Gemini-3-Flash-Preview",
  "deepseek-v4-pro",
  "DeepSeek-V4-Pro",
  "glm-5.1"
];
// Models LiteLLM keys only under their provider's prefix (`zai/glm-5.1`, `xai/grok-4.20`, `gemini/…`, `moonshot/…`,
// `minimax/…`); the snapshot keys them by the bare name the agents record.
const PREFIXED = ["glm-5.1", "grok-4.20", "grok-code-fast-1", "gemini-omni-1.1-flash", "kimi-k2.6", "MiniMax-M2.5"];
// The usage fixtures' synthetic ids, which LiteLLM does not price; a short key must not price them either.
const SYNTHETIC = ["claude-test", "gpt-test", "gemini-test", "gemini-flash-test", "grok-test", "model-test", "m1"];

function priceOf(model: string): Price {
  const price = pricing.priceOf(model);
  if (price === undefined) {
    throw new Error(`${model} has no price`);
  }
  return price;
}

function record(model: string, usage: UsageRecord["usage"], fields: Partial<UsageRecord> = {}): UsageRecord {
  return {
    agent: "claude-code",
    sessionId: "s1",
    granularity: "request",
    timestamp: Date.parse("2026-01-02T12:00:00.000Z"),
    model,
    usage,
    source: { file: "/u/me/s1.jsonl", offset: 0, length: 1, line: 1 },
    ...fields
  };
}

describe("litellmPrices", () => {
  it("prices every model of the kit's fixtures that LiteLLM prices, and no synthetic one", () => {
    expect([...CLAUDE, ...OTHERS].filter((model) => pricing.priceOf(model) === undefined)).toEqual([]);
    expect(SYNTHETIC.filter((model) => pricing.priceOf(model) !== undefined)).toEqual([]);
  });

  it("prices the bare names of models LiteLLM keys under a provider prefix", () => {
    expect(PREFIXED.filter((model) => pricing.priceOf(model) === undefined)).toEqual([]);
    expect(Object.keys(litellmPrices).filter((key) => key.includes("/"))).toEqual([]);
  });

  it("gives Claude models their one-hour cache write price", () => {
    const lacking = CLAUDE.filter((model) => {
      const { cacheWrite, cacheWrite1h } = priceOf(model);
      return cacheWrite1h === undefined || cacheWrite1h <= cacheWrite;
    });
    expect(lacking).toEqual([]);
  });

  it("is the table fromLiteLLM reads from the snapshot, with every entry priced", () => {
    expect(litellmPrices).toEqual(fromLiteLLM(snapshot.prices));
    expect(Object.keys(litellmPrices)).toHaveLength(Object.keys(snapshot.prices).length);
  });

  it("names its version by the generation date and LiteLLM's commit", () => {
    expect(litellmPricesVersion).toMatch(/^\d{4}-\d{2}-\d{2}\+[0-9a-f]{40}$/);
  });

  it("prices usage records by model with priceRecord", () => {
    const opus = priceOf("claude-opus-4-8");
    const gpt = priceOf("gpt-5.5");
    // 1M input without cache, 1M output, 1M five-minute and 1M one-hour cache writes, 1M cache reads.
    const cached = record("claude-opus-4-8-20260101", {
      inputTokens: 4 * M,
      outputTokens: M,
      cacheReadTokens: M,
      cacheWriteTokens: 2 * M,
      cacheWrite1hTokens: M
    });
    const codex = record("gpt-5.5-codex", { inputTokens: M, outputTokens: M }, { agent: "codex" });
    expect(priceRecord(cached, pricing).parts[0]?.cost).toEqual({
      costUsd: expect.closeTo(opus.input + opus.output + opus.cacheWrite + (opus.cacheWrite1h ?? NaN) + opus.cacheRead),
      costSource: "pricing-table"
    });
    expect(priceRecord(codex, pricing).parts[0]?.cost).toEqual({
      costUsd: expect.closeTo(gpt.input + gpt.output),
      costSource: "pricing-table"
    });
    expect(priceRecord(record("mystery", { inputTokens: M }), pricing).parts).toEqual([
      { model: "mystery", usage: { inputTokens: M } }
    ]);
  });
});
