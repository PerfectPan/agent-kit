import { describe, expect, it } from "vite-plus/test";

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
  it("S70: takes the table's key for the model's id or dated id, else the longest alias its id contains, in any case", () => {
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

  it("S70: merges a partial override over the price of each model containing its key, and wins over the table", () => {
    // The other prices come from the model's own price: the snapshot's for claude-opus-4-8, the opus alias's otherwise.
    const opus = presence({ opus: { input: 99 } });
    expect(opus.priceOf("opus")).toMatchObject({ input: 99, output: 75 });
    expect(opus.priceOf("claude-opus-4-8")).toMatchObject({ input: 99, output: 25 });
    expect(opus.priceOf("claude-3-opus")?.input).toBe(99);
    expect(presence({ "GPT-5.5": { input: 7 } }).priceOf("gpt-5.5")).toEqual({
      input: 7,
      output: 30,
      cacheWrite: 5,
      cacheRead: 0.5
    });
    expect(presence({ "claude-opus-4-8": { input: 99 } }).priceOf("anthropic/claude-opus-4-8-20260101")).toMatchObject({
      input: 99,
      output: 25
    });
  });

  it("prices a model by a table key only as its id, its id with a date, or either after a provider prefix", () => {
    const pricing = createPricing(SNAPSHOT);
    const same = [
      "claude-opus-4-8-20260101",
      "claude-opus-4-8-2026-01-01",
      "claude-opus-4-8@20260101",
      "anthropic/claude-opus-4-8",
      "Anthropic/Claude-Opus-4-8@20260101"
    ];
    expect(same.filter((model) => pricing.priceOf(model) !== SNAPSHOT["claude-opus-4-8"])).toEqual([]);
    // Endings that name other models, the key inside a longer name, and forms beyond one prefix and a date.
    const others = [
      "claude-opus-4-8-latest",
      "claude-opus-4-8-preview",
      "claude-opus-4-8-mini",
      "claude-opus-4-8.1",
      "claude-opus-4-8-0101",
      "claude-opus-4-8-v1:0",
      "gpt-5.5-codex",
      "gpt-5.6-sol-turbo",
      "x-claude-opus-4-8",
      "openrouter/anthropic/claude-opus-4-8",
      "us.anthropic.claude-opus-4-8-20260101-v1:0"
    ];
    expect(others.filter((model) => pricing.priceOf(model) !== undefined)).toEqual([]);
  });

  it("takes the key of the id itself over the id without its date or prefix", () => {
    const alias = { input: 2.5, output: 10, cacheWrite: 2.5, cacheRead: 1.25 };
    const dated = { input: 5, output: 15, cacheWrite: 5, cacheRead: 5 };
    const routed = { input: 3, output: 12, cacheWrite: 3, cacheRead: 1.5 };
    const table = { "gpt-4o": alias, "gpt-4o-2024-05-13": dated, "azure/gpt-4o": routed };
    const pricing = createPricing(table);
    expect(pricing.priceOf("gpt-4o-2024-05-13")).toBe(dated);
    expect(pricing.priceOf("openai/gpt-4o-2024-05-13")).toBe(dated);
    expect(pricing.priceOf("gpt-4o-2024-08-06")).toBe(alias);
    expect(pricing.priceOf("azure/gpt-4o")).toBe(routed);
    expect(pricing.priceOf("azure/gpt-4o-2024-08-06")).toBe(routed);
  });

  it("applies an override to every id that contains its key, whether the table or an alias prices the id", () => {
    const opus = presence({ OPUS: { input: 99 } });
    expect(opus.priceOf("claude-opus-4-8")).toEqual({ ...SNAPSHOT["claude-opus-4-8"], input: 99 });
    expect(opus.priceOf("Anthropic/Claude-3-Opus")).toEqual({ ...ALIASES.opus, input: 99 });
    expect(opus.priceOf("gpt-5.5")).toBe(SNAPSHOT["gpt-5.5"]);
    const opus4 = { input: 20, output: 100, cacheWrite: 25, cacheRead: 2 };
    const longer = createPricing({}, { fallback: { ...ALIASES, "opus-4": opus4 }, overrides: { opus: { input: 99 } } });
    expect(longer.priceOf("claude-opus-4-9")).toEqual({ ...opus4, input: 99 });
  });

  it("fills a partial override with the price the id has without it", () => {
    const base = { input: 2.5, output: 10, cacheWrite: 2.5, cacheRead: 1.25 };
    const dated = { input: 5, output: 15, cacheWrite: 5, cacheRead: 5 };
    const table = { "gpt-4o": base, "gpt-4o-2024-05-13": dated };
    const pricing = createPricing(table, { overrides: { "gpt-4o": { input: 1 } } });
    expect(pricing.priceOf("gpt-4o-2024-08-06")).toEqual({ ...base, input: 1 });
    expect(pricing.priceOf("gpt-4o-2024-05-13")).toEqual({ ...dated, input: 1 });
    // A key that only the overrides have takes the rest from the alias the id contains.
    expect(presence({ "claude-opus-4-9": { input: 20 } }).priceOf("claude-opus-4-9")).toEqual({
      ...ALIASES.opus,
      input: 20
    });
  });

  it("takes the longest override key the id contains", () => {
    const pricing = presence({
      opus: { input: 50 },
      "claude-opus-4-8": { input: 99 },
      "claude-opus-4-9": { input: 20 }
    });
    expect(pricing.priceOf("claude-opus-4-8")).toEqual({ ...SNAPSHOT["claude-opus-4-8"], input: 99 });
    expect(pricing.priceOf("claude-opus-4-9")?.input).toBe(20);
    expect(pricing.priceOf("claude-3-opus")?.input).toBe(50);
  });

  it("prices a model that no table or override key matches by the longest fallback alias its id contains", () => {
    expect(presence().priceOf("claude-opus-4-9")?.input).toBe(15);
    expect(presence().priceOf("Anthropic/Claude-3-OPUS")?.input).toBe(15);
    expect(presence().priceOf("gpt-5.7")?.input).toBe(1.25);
    expect(createPricing(SNAPSHOT).priceOf("gpt-5.7")).toBeUndefined();
    const gpt = { input: 2, output: 8, cacheWrite: 2, cacheRead: 0.2 };
    expect(createPricing({}, { fallback: { gpt, ...ALIASES } }).priceOf("gpt-5.7")?.input).toBe(1.25);
  });

  it("prices a model only an override knows, and nothing when the id has no price to fill a partial override", () => {
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
