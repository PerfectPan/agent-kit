import { describe, expect, it } from "vite-plus/test";

import { formatSnapshot, nextSnapshot, selectPrices, versionOf } from "./litellm-snapshot.ts";

const SHA = "de5dc5b238b6e972869d7dedc6ba3c4fb8d931fe";

// Entries in the shape of LiteLLM's model_prices_and_context_window.json, with the fields that decide the selection.
const LITELLM = {
  sample_spec: {
    input_cost_per_token: 0,
    output_cost_per_token: 0,
    litellm_provider: "one of https://docs.litellm.ai/docs/providers",
    mode: "one of: chat, embedding, completion"
  },
  "claude-opus-4-8": {
    input_cost_per_token: 5e-6,
    output_cost_per_token: 2.5e-5,
    cache_creation_input_token_cost: 6.25e-6,
    cache_creation_input_token_cost_above_1hr: 1e-5,
    cache_read_input_token_cost: 5e-7,
    input_cost_per_token_batches: 2.5e-6,
    max_input_tokens: 1_000_000,
    litellm_provider: "anthropic",
    mode: "chat"
  },
  "bedrock/us-east-1/anthropic.claude-opus-4-8": {
    input_cost_per_token: 5.5e-6,
    output_cost_per_token: 2.75e-5,
    litellm_provider: "bedrock",
    mode: "chat"
  },
  "vertex_ai/claude-opus-4-8": {
    input_cost_per_token: 5e-6,
    output_cost_per_token: 2.5e-5,
    litellm_provider: "vertex_ai-anthropic_models",
    mode: "chat"
  },
  // Floating-point noise in LiteLLM's number, and a cache read price that is not a number.
  "gpt-5.5": {
    input_cost_per_token: 5.000000000000001e-6,
    output_cost_per_token: 3e-5,
    cache_read_input_token_cost: null,
    litellm_provider: "openai",
    mode: "responses"
  },
  "openrouter/openai/gpt-5.5": {
    input_cost_per_token: 5e-6,
    output_cost_per_token: 3e-5,
    litellm_provider: "openrouter",
    mode: "chat"
  },
  "gpt-image-2": {
    input_cost_per_token: 5e-6,
    output_cost_per_token: 4e-5,
    litellm_provider: "openai",
    mode: "image_generation"
  },
  "openai/container": { code_interpreter_cost_per_session: 0.03, litellm_provider: "openai", mode: "chat" },
  "gemini/gemini-3.5-flash": {
    input_cost_per_token: 3e-7,
    output_cost_per_token: 2.5e-6,
    cache_read_input_token_cost: 3e-8,
    litellm_provider: "gemini",
    mode: "chat"
  },
  "vertex_ai/gemini-3.5-flash-lite": {
    input_cost_per_token: 1e-7,
    output_cost_per_token: 4e-7,
    litellm_provider: "vertex_ai-language-models",
    mode: "chat"
  },
  "xai/grok-4.20": { input_cost_per_token: 2e-6, output_cost_per_token: 6e-6, litellm_provider: "xai", mode: "chat" },
  // The same model under the provider's prefix and bare: the bare key wins whichever comes first.
  "deepseek/deepseek-v4-pro": {
    input_cost_per_token: 1.74e-6,
    output_cost_per_token: 3.48e-6,
    litellm_provider: "deepseek",
    mode: "chat"
  },
  "deepseek-v4-pro": {
    input_cost_per_token: 1.32e-6,
    output_cost_per_token: 2.64e-6,
    cache_read_input_token_cost: 1.1e-7,
    litellm_provider: "deepseek",
    mode: "chat"
  },
  "zai/glm-5.1": { input_cost_per_token: 1e-6, output_cost_per_token: 3.2e-6, litellm_provider: "zai", mode: "chat" },
  "zai/glm-5.1-no-output": { input_cost_per_token: 1e-6, litellm_provider: "zai", mode: "chat" },
  "mistral/devstral-latest": {
    input_cost_per_token: 4e-7,
    output_cost_per_token: 2e-6,
    litellm_provider: "mistral",
    mode: "chat"
  }
};

const SELECTED = {
  "claude-opus-4-8": {
    input_cost_per_token: 0.000005,
    output_cost_per_token: 0.000025,
    cache_creation_input_token_cost: 0.00000625,
    cache_creation_input_token_cost_above_1hr: 0.00001,
    cache_read_input_token_cost: 5e-7
  },
  "deepseek-v4-pro": {
    input_cost_per_token: 0.00000132,
    output_cost_per_token: 0.00000264,
    cache_read_input_token_cost: 1.1e-7
  },
  "gemini-3.5-flash": {
    input_cost_per_token: 3e-7,
    output_cost_per_token: 0.0000025,
    cache_read_input_token_cost: 3e-8
  },
  "glm-5.1": { input_cost_per_token: 0.000001, output_cost_per_token: 0.0000032 },
  "gpt-5.5": { input_cost_per_token: 0.000005, output_cost_per_token: 0.00003 },
  "grok-4.20": { input_cost_per_token: 0.000002, output_cost_per_token: 0.000006 }
};

const COMMITS = [
  { sha: SHA, commit: { committer: { date: "2026-10-25T01:20:36Z" } }, parents: [] },
  { sha: "0".repeat(40), commit: { committer: { date: "2026-10-24T09:00:00Z" } } }
];

describe("selectPrices", () => {
  it("keeps the first-party chat models under their bare names, with only the fields fromLiteLLM reads", () => {
    const prices = selectPrices(LITELLM);
    expect(prices).toEqual(SELECTED);
    expect(Object.keys(prices)).toEqual(Object.keys(SELECTED));
  });

  it("drops an entry's own provider prefix", () => {
    const prices = selectPrices(LITELLM);
    expect(Object.keys(prices)).toEqual(expect.arrayContaining(["grok-4.20", "glm-5.1", "gemini-3.5-flash"]));
    expect(Object.keys(prices).filter((name) => name.includes("/"))).toEqual([]);
  });

  it("leaves out routes through other providers, which keep a / after the prefix is dropped", () => {
    const routes = {
      "vertex_ai/gemini-3.5-flash-lite": LITELLM["vertex_ai/gemini-3.5-flash-lite"],
      "openrouter/openai/gpt-5.5": LITELLM["openrouter/openai/gpt-5.5"],
      "low/1024-x-1024/gpt-image-2": { ...LITELLM["gpt-5.5"], litellm_provider: "openai", mode: "chat" },
      "zai/glm-5.1": LITELLM["zai/glm-5.1"]
    };
    expect(Object.keys(selectPrices(routes))).toEqual(["glm-5.1"]);
  });

  it("prefers the bare key when a prefixed key names the same model, in either order", () => {
    const bare = LITELLM["deepseek-v4-pro"];
    const prefixed = LITELLM["deepseek/deepseek-v4-pro"];
    for (const list of [
      { "deepseek/deepseek-v4-pro": prefixed, "deepseek-v4-pro": bare },
      { "deepseek-v4-pro": bare, "deepseek/deepseek-v4-pro": prefixed }
    ]) {
      expect(selectPrices(list)).toEqual({ "deepseek-v4-pro": SELECTED["deepseek-v4-pro"] });
    }
  });

  it("gives the same file for the same entries in any order", () => {
    const reversed = Object.fromEntries(Object.entries(LITELLM).reverse());
    expect(formatSnapshot({ version: "v", prices: selectPrices(reversed) })).toBe(
      formatSnapshot({ version: "v", prices: selectPrices(LITELLM) })
    );
  });

  it("fails instead of writing an empty table when the list's format has changed", () => {
    expect(() => selectPrices({ "gpt-5.5": { input_cost_per_token: 5e-6, litellm_provider: "openai" } })).toThrow(
      /format/
    );
    expect(() => selectPrices([])).toThrow(/"expected": "record"/);
  });
});

describe("versionOf", () => {
  it("names the latest commit by its date and sha", () => {
    expect(versionOf(COMMITS)).toEqual({ commit: SHA, version: `2026-10-25+${SHA}` });
  });

  it("rejects a listing without a commit or with an abbreviated sha", () => {
    expect(() => versionOf([])).toThrow(/"expected": "object"/);
    expect(() =>
      versionOf([{ sha: SHA.slice(0, 12), commit: { committer: { date: "2026-10-25T01:20:36Z" } } }])
    ).toThrow(/"sha"/);
  });
});

describe("nextSnapshot", () => {
  const current = formatSnapshot({ version: `2026-10-18+${"1".repeat(40)}`, prices: SELECTED });

  it("leaves the file as it is when a new commit changes no price it keeps", () => {
    expect(nextSnapshot(current, SELECTED, `2026-10-25+${SHA}`)).toBeUndefined();
  });

  it("writes the new prices under the new version", () => {
    const prices = { ...SELECTED, "glm-5.1": { input_cost_per_token: 0.0000012, output_cost_per_token: 0.000004 } };
    expect(nextSnapshot(current, prices, `2026-10-25+${SHA}`)).toBe(
      formatSnapshot({ version: `2026-10-25+${SHA}`, prices })
    );
    expect(nextSnapshot(undefined, SELECTED, `2026-10-25+${SHA}`)).toBe(
      formatSnapshot({ version: `2026-10-25+${SHA}`, prices: SELECTED })
    );
  });
});
