import { readFileSync } from "node:fs";

import * as z from "zod/mini";
import { describe, expect, it } from "vite-plus/test";

import { fromLiteLLM } from "../../packages/cost/src/domain/pricing/adapters/from-litellm.ts";
import { priceOfEntry } from "../../packages/cost/src/domain/pricing/adapters/litellm-entry.ts";
import {
  formatSnapshot,
  nextSnapshot,
  priceDigest,
  selectPrices,
  snapshotVersion,
  versionOf,
  type SnapshotEntry
} from "./litellm-snapshot.ts";

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
  // Floating-point noise in LiteLLM's number, and a cache read price that is not a number. The tier's fields come
  // along under their threshold; the flex variant and the twelve-hour cache-write tier do not.
  "gpt-5.5": {
    input_cost_per_token: 5.000000000000001e-6,
    output_cost_per_token: 3e-5,
    cache_read_input_token_cost: null,
    input_cost_per_token_above_272k_tokens: 1e-5,
    output_cost_per_token_above_272k_tokens: 4.5e-5,
    input_cost_per_token_above_272k_tokens_flex: 9e-6,
    cache_creation_input_token_cost_above_12hr_above_272k_tokens: 8e-6,
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
  "gpt-5.5": {
    input_cost_per_token: 0.000005,
    output_cost_per_token: 0.00003,
    long_context: { above_tokens: 272_000, input_cost_per_token: 1e-5, output_cost_per_token: 4.5e-5 }
  },
  "grok-4.20": { input_cost_per_token: 0.000002, output_cost_per_token: 0.000006 }
};

// The LiteLLM key each selected name is taken from.
const SOURCES = {
  "claude-opus-4-8": "claude-opus-4-8",
  "deepseek-v4-pro": "deepseek-v4-pro",
  "gemini-3.5-flash": "gemini/gemini-3.5-flash",
  "glm-5.1": "zai/glm-5.1",
  "gpt-5.5": "gpt-5.5",
  "grok-4.20": "xai/grok-4.20"
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

  // litellmPrices converts the kept entries with priceOfEntry, so its prices are those fromLiteLLM reads from the
  // whole list only when the rounding and the dropped fields change nothing.
  it("keeps the prices fromLiteLLM reads from each kept entry", () => {
    const read = fromLiteLLM(LITELLM);
    const kept = Object.entries(selectPrices(LITELLM)).map(([name, entry]) => [name, priceOfEntry(entry)]);
    expect(Object.fromEntries(kept)).toStrictEqual(
      Object.fromEntries(Object.entries(SOURCES).map(([name, key]) => [name, read[key]]))
    );
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

describe("snapshotVersion", () => {
  const source = versionOf(COMMITS).version;

  it("appends the prices' digest, so the same commit with different prices versions differently", () => {
    const altered = { ...SELECTED, "glm-5.1": { input_cost_per_token: 0.0000012, output_cost_per_token: 0.000004 } };
    const version = snapshotVersion(source, SELECTED);
    expect(version).toBe(`${source}+${priceDigest(SELECTED)}`);
    expect(version).toMatch(/[0-9a-f]{12}$/);
    expect(snapshotVersion(source, altered)).not.toBe(version);
  });

  it("digests the prices' content, not the order their keys are named in", () => {
    const reversed = (value: unknown): unknown => {
      if (Array.isArray(value)) {
        return value.map((item) => reversed(item));
      }
      if (value === null || typeof value !== "object") {
        return value;
      }
      return Object.fromEntries(
        Object.entries(value)
          .reverse()
          .map(([key, item]) => [key, reversed(item)])
      );
    };
    expect(priceDigest(reversed(SELECTED) as Record<string, SnapshotEntry>)).toBe(priceDigest(SELECTED));
  });

  it("the committed snapshot's version ends with its own prices' digest", () => {
    const Committed = z.object({ version: z.string(), prices: z.record(z.string(), z.unknown()) });
    const snapshot = z.parse(
      Committed,
      JSON.parse(
        readFileSync(
          new URL("../../packages/cost/src/domain/pricing/adapters/litellm-snapshot.json", import.meta.url),
          "utf8"
        )
      )
    );
    // The cost package's import of this file checks every entry against LiteLLMEntry at compile time; this test only
    // re-derives the version, so the parsed record digests as the prices it is.
    expect(snapshot.version.endsWith(`+${priceDigest(snapshot.prices as Record<string, SnapshotEntry>)}`)).toBe(true);
  });
});

describe("nextSnapshot", () => {
  const held = `2026-10-18+${"1".repeat(40)}`;
  const current = formatSnapshot({ version: snapshotVersion(held, SELECTED), prices: SELECTED });

  it("leaves the file as it is when a new commit changes no price it keeps", () => {
    expect(nextSnapshot(current, SELECTED, snapshotVersion(`2026-10-25+${SHA}`, SELECTED))).toBeUndefined();
  });

  it("leaves the file as it is when only the order of a tier's fields differs", () => {
    // gpt-5.5's tier from SELECTED, with the same fields in the reverse order.
    const reordered = {
      ...SELECTED,
      "gpt-5.5": {
        ...SELECTED["gpt-5.5"]!,
        long_context: { output_cost_per_token: 4.5e-5, input_cost_per_token: 1e-5, above_tokens: 272_000 }
      }
    };
    expect(nextSnapshot(current, reordered, snapshotVersion(`2026-10-25+${SHA}`, reordered))).toBeUndefined();
  });

  it("rewrites the file when the version does not end in these prices' digest, at the same prices", () => {
    const legacy = formatSnapshot({ version: held, prices: SELECTED });
    expect(nextSnapshot(legacy, SELECTED, snapshotVersion(`2026-10-25+${SHA}`, SELECTED))).toBe(
      formatSnapshot({ version: snapshotVersion(`2026-10-25+${SHA}`, SELECTED), prices: SELECTED })
    );
  });

  it("writes the new prices under the new version", () => {
    const prices = { ...SELECTED, "glm-5.1": { input_cost_per_token: 0.0000012, output_cost_per_token: 0.000004 } };
    expect(nextSnapshot(current, prices, snapshotVersion(`2026-10-25+${SHA}`, prices))).toBe(
      formatSnapshot({ version: snapshotVersion(`2026-10-25+${SHA}`, prices), prices })
    );
    expect(nextSnapshot(undefined, SELECTED, snapshotVersion(`2026-10-25+${SHA}`, SELECTED))).toBe(
      formatSnapshot({ version: snapshotVersion(`2026-10-25+${SHA}`, SELECTED), prices: SELECTED })
    );
  });
});
