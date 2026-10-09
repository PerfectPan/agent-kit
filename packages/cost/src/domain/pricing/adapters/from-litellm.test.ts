import { describe, expect, it } from "vitest";

import { createPricing } from "../value-objects/pricing-table.js";
import { fromLiteLLM } from "./from-litellm.js";

// Entries in the shape of LiteLLM's model_prices_and_context_window.json, trimmed to the fields that matter.
const LITELLM = {
  sample_spec: { input_cost_per_token: 0, output_cost_per_token: 0, litellm_provider: "one of the providers" },
  "claude-opus-4-8": {
    input_cost_per_token: 5e-6,
    output_cost_per_token: 2.5e-5,
    cache_creation_input_token_cost: 6.25e-6,
    cache_creation_input_token_cost_above_1hr: 1e-5,
    cache_read_input_token_cost: 5e-7,
    input_cost_per_token_batches: 2.5e-6,
    litellm_provider: "anthropic",
    mode: "chat"
  },
  "gpt-5.5": {
    input_cost_per_token: 5e-6,
    output_cost_per_token: 3e-5,
    cache_read_input_token_cost: 5e-7,
    input_cost_per_token_priority: 1.25e-5,
    input_cost_per_token_above_272k_tokens: 1e-5
  },
  "deepseek-v4-pro": {
    input_cost_per_token: 4.35e-7,
    output_cost_per_token: 8.7e-7,
    cache_creation_input_token_cost: 0,
    cache_read_input_token_cost: 3.625e-9
  },
  "embedding-only": { input_cost_per_token: 1e-7, mode: "embedding" },
  "no-cache-prices": { input_cost_per_token: 2e-6, output_cost_per_token: 1.2e-5 },
  "text-prices": { input_cost_per_token: "0.000001", output_cost_per_token: 2e-6 },
  broken: null
};

describe("fromLiteLLM", () => {
  it("S74: converts per-token prices into prices per million tokens, as presence's snapshot holds them", () => {
    expect(fromLiteLLM(LITELLM)).toEqual({
      "claude-opus-4-8": { input: 5, output: 25, cacheWrite: 6.25, cacheWrite1h: 10, cacheRead: 0.5 },
      "gpt-5.5": { input: 5, output: 30, cacheWrite: 5, cacheRead: 0.5 },
      "deepseek-v4-pro": { input: 0.435, output: 0.87, cacheWrite: 0, cacheRead: 0.003625 },
      "no-cache-prices": { input: 2, output: 12, cacheWrite: 2, cacheRead: 2 }
    });
  });

  it("returns an empty table for anything but an object", () => {
    expect(fromLiteLLM(null)).toEqual({});
    expect(fromLiteLLM("prices")).toEqual({});
  });

  it("drops an entry whose price is not a finite number, and keeps the rest of the table", () => {
    expect(
      fromLiteLLM({
        "infinite-cost": { input_cost_per_token: Infinity, output_cost_per_token: 2e-5 },
        "nan-cost": { input_cost_per_token: NaN, output_cost_per_token: 2e-5 },
        "ok-model": { input_cost_per_token: 2e-6, output_cost_per_token: 1.2e-5 }
      })
    ).toEqual({ "ok-model": { input: 2, output: 12, cacheWrite: 2, cacheRead: 2 } });
  });

  it("gives a table that createPricing looks models up in", () => {
    const pricing = createPricing(fromLiteLLM(LITELLM));
    expect(pricing.priceOf("claude-opus-4-8-20260101")?.cacheWrite1h).toBe(10);
    expect(pricing.priceOf("sample_spec")).toBeUndefined();
  });
});
