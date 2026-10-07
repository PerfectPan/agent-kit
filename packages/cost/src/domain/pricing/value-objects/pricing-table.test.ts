import { describe, expect, it } from "vitest";

import { createPricing, type PriceOverrides, type PricingTable } from "./pricing-table.js";

// Ported from presence's pricing tests: the entries of its LiteLLM snapshot that they use, and its fallback aliases.
const SNAPSHOT: PricingTable = {
  "claude-fable-5": { input: 10, output: 50, cacheWrite: 12.5, cacheWrite1h: 20, cacheRead: 1 },
  "claude-opus-4-8": { input: 5, output: 25, cacheWrite: 6.25, cacheWrite1h: 10, cacheRead: 0.5 },
  "claude-sonnet-4-6": { input: 3, output: 15, cacheWrite: 3.75, cacheWrite1h: 6, cacheRead: 0.3 },
  "claude-sonnet-5": { input: 2, output: 10, cacheWrite: 2.5, cacheWrite1h: 4, cacheRead: 0.2 },
  "deepseek-v4-pro": { input: 0.435, output: 0.87, cacheWrite: 0, cacheRead: 0.003625 },
  "gemini-3-flash-preview": { input: 0.5, output: 3, cacheWrite: 0.5, cacheRead: 0.05 },
  "gpt-5.5": { input: 5, output: 30, cacheWrite: 5, cacheRead: 0.5 },
  "gpt-5.6-sol": { input: 5, output: 30, cacheWrite: 6.25, cacheRead: 0.5 }
};
const ALIASES: PricingTable = {
  opus: { input: 15, output: 75, cacheWrite: 18.75, cacheWrite1h: 30, cacheRead: 1.5 },
  sonnet: { input: 3, output: 15, cacheWrite: 3.75, cacheWrite1h: 6, cacheRead: 0.3 },
  haiku: { input: 1, output: 5, cacheWrite: 1.25, cacheWrite1h: 2, cacheRead: 0.1 },
  "gpt-5": { input: 1.25, output: 10, cacheWrite: 1.25, cacheRead: 0.125 }
};

const presence = (overrides?: PriceOverrides) =>
  createPricing(SNAPSHOT, { fallback: ALIASES, ...(overrides ? { overrides } : {}) });

describe("createPricing", () => {
  it("S70: takes the model's own id, then the longest key its id contains, regardless of case", () => {
    const pricing = presence();
    expect(pricing.priceOf("claude-opus-4-8")?.input).toBe(5);
    expect(pricing.priceOf("claude-sonnet-4-6")?.input).toBe(3);
    // The snapshot's gpt-5.5 beats the broader gpt-5 alias.
    expect(pricing.priceOf("gpt-5.5")).toMatchObject({ input: 5, output: 30 });
    expect(pricing.priceOf("claude-opus-4-8-20260101")?.input).toBe(5);
    expect(pricing.priceOf("CLAUDE-OPUS-4-8")?.input).toBe(5);
    expect(pricing.priceOf("claude-3-opus")?.input).toBe(15);
    expect(pricing.priceOf("gpt-5.1-codex")?.input).toBe(1.25);
    expect(pricing.priceOf("DeepSeek-V4-Pro")).toEqual({
      input: 0.435,
      output: 0.87,
      cacheWrite: 0,
      cacheRead: 0.003625
    });
    expect(pricing.priceOf("Gemini-3-Flash-Preview")).toEqual({
      input: 0.5,
      output: 3,
      cacheWrite: 0.5,
      cacheRead: 0.05
    });
  });

  it("S70: has no price for an unknown model", () => {
    expect(presence().priceOf("some-unknown-model")).toBeUndefined();
    expect(createPricing({}).priceOf("claude-opus-4-8")).toBeUndefined();
  });

  it("S70: merges a partial override over the entry with the same key, which wins over longer table keys", () => {
    // The override key is `opus`, so its other prices come from the opus alias, not from claude-opus-4-8.
    expect(presence({ opus: { input: 99 } }).priceOf("claude-opus-4-8")).toMatchObject({ input: 99, output: 75 });
    expect(presence({ "GPT-5.5": { input: 7 } }).priceOf("gpt-5.5")).toEqual({
      input: 7,
      output: 30,
      cacheWrite: 5,
      cacheRead: 0.5
    });
  });

  it("prices a model only an override knows, and nothing when its override lacks prices and has no base entry", () => {
    const full = { input: 15, output: 75, cacheWrite: 18.75, cacheRead: 1.5 };
    expect(presence({ "openrouter-3o": full }).priceOf("openrouter-3o")).toEqual(full);
    expect(presence({ "openrouter-3o": { input: 15 } }).priceOf("openrouter-3o")).toBeUndefined();
  });

  it("prefers the table's entry over the fallback's for the same key in any case", () => {
    const table = { "GPT-5": { input: 2, output: 8, cacheWrite: 2, cacheRead: 0.2 } };
    expect(createPricing(table, { fallback: ALIASES }).priceOf("gpt-5")?.input).toBe(2);
  });

  it("prices current snapshot models with their one-hour cache write price", () => {
    expect(presence().priceOf("claude-fable-5")).toEqual({
      input: 10,
      output: 50,
      cacheWrite: 12.5,
      cacheWrite1h: 20,
      cacheRead: 1
    });
    expect(presence().priceOf("gpt-5.6-sol")).toMatchObject({ input: 5, output: 30, cacheWrite: 6.25, cacheRead: 0.5 });
    expect(presence().priceOf("claude-sonnet-5")).toMatchObject({
      input: 2,
      output: 10,
      cacheWrite: 2.5,
      cacheRead: 0.2
    });
  });

  it("returns the same answer for a model it already looked up", () => {
    const pricing = presence();
    expect(pricing.priceOf("claude-opus-4-8")).toBe(pricing.priceOf("claude-opus-4-8"));
    expect(pricing.priceOf("mystery")).toBeUndefined();
    expect(pricing.priceOf("mystery")).toBeUndefined();
  });
});
