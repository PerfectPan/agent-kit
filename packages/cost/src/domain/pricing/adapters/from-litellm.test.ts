import { describe, expect, it } from "vite-plus/test";

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

// A tier over a model with a base cache read and no base cache write keeps the write at the tier's input price.
const GEMINI_TIER = {
  "gemini-pro-tier": {
    input_cost_per_token: 1.25e-6,
    output_cost_per_token: 1.25e-5,
    cache_read_input_token_cost: 3.15e-7,
    input_cost_per_token_above_200k_tokens: 2.5e-6,
    output_cost_per_token_above_200k_tokens: 2.5e-5,
    cache_read_input_token_cost_above_200k_tokens: 6.25e-7
  },
  "tier-1h-and-variants": {
    input_cost_per_token: 2e-6,
    output_cost_per_token: 1.2e-5,
    cache_creation_input_token_cost: 3.75e-6,
    cache_creation_input_token_cost_above_1hr: 7.5e-6,
    input_cost_per_token_above_272k_tokens: 4e-6,
    cache_creation_input_token_cost_above_1hr_above_272k_tokens: 6e-6,
    input_cost_per_token_above_272k_tokens_flex: 9e-6,
    cache_creation_input_token_cost_above_12hr_above_272k_tokens: 8e-6
  },
  // Without a base cache price, the tier bills that cache kind at the tier's input price. A tier value that is not
  // a number reads as absent, and the largest of two thresholds wins.
  "two-thresholds": {
    input_cost_per_token: 1e-6,
    output_cost_per_token: 1e-5,
    input_cost_per_token_above_128k_tokens: 2e-6,
    input_cost_per_token_above_272k_tokens: 3e-6,
    output_cost_per_token_above_272k_tokens: null
  }
};

describe("fromLiteLLM", () => {
  it("S74: converts per-token prices into prices per million tokens, as presence's snapshot holds them", () => {
    expect(fromLiteLLM(LITELLM)).toEqual({
      "claude-opus-4-8": { input: 5, output: 25, cacheWrite: 6.25, cacheWrite1h: 10, cacheRead: 0.5 },
      "gpt-5.5": {
        input: 5,
        output: 30,
        cacheWrite: 5,
        cacheRead: 0.5,
        longContext: { thresholdTokens: 272_000, input: 10, cacheWrite: 10 }
      },
      "deepseek-v4-pro": { input: 0.435, output: 0.87, cacheWrite: 0, cacheRead: 0.003625 },
      "no-cache-prices": { input: 2, output: 12, cacheWrite: 2, cacheRead: 2 }
    });
  });

  it("keeps a model's long-context tier with its threshold, and leaves the service-tier and other-lifetime variants out", () => {
    expect(fromLiteLLM(GEMINI_TIER)).toEqual({
      "gemini-pro-tier": {
        input: 1.25,
        output: 12.5,
        cacheWrite: 1.25,
        cacheRead: 0.315,
        longContext: { thresholdTokens: 200_000, input: 2.5, output: 25, cacheRead: 0.625, cacheWrite: 2.5 }
      },
      "tier-1h-and-variants": {
        input: 2,
        output: 12,
        cacheWrite: 3.75,
        cacheWrite1h: 7.5,
        cacheRead: 2,
        longContext: { thresholdTokens: 272_000, input: 4, cacheRead: 4, cacheWrite1h: 6 }
      },
      "two-thresholds": {
        input: 1,
        output: 10,
        cacheWrite: 1,
        cacheRead: 1,
        longContext: { thresholdTokens: 272_000, input: 3, cacheRead: 3, cacheWrite: 3 }
      }
    });
  });

  it("returns an empty table for anything but an object", () => {
    expect(fromLiteLLM(null)).toEqual({});
    expect(fromLiteLLM("prices")).toEqual({});
  });

  it("keeps an entry whose cache price is present but not a finite number, and falls back to the input price", () => {
    expect(
      fromLiteLLM({
        "null-cache-read": {
          input_cost_per_token: 2e-6,
          output_cost_per_token: 1.2e-5,
          cache_read_input_token_cost: null
        },
        "infinite-cache-write": {
          input_cost_per_token: 2e-6,
          output_cost_per_token: 1.2e-5,
          cache_creation_input_token_cost: Infinity
        }
      })
    ).toEqual({
      "null-cache-read": { input: 2, output: 12, cacheWrite: 2, cacheRead: 2 },
      "infinite-cache-write": { input: 2, output: 12, cacheWrite: 2, cacheRead: 2 }
    });
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
