import { codexUsageDecoder } from "../src/usage.js";
const testUsage = { codex: codexUsageDecoder };
import { codex } from "../src/identity.js";
const testIdentity = { codex };
import type { CodingAgentId } from "@rivus/agent-kit-catalog/public";
import {
  addUsage,
  type Usage,
  decodeUsage,
  type DecodeUsageOptions,
  isUsageRecord,
  type UsageRecord
} from "@rivus/agent-kit-sessions/public";
import { describe, expect, it } from "vite-plus/test";

import { createMemoryPlatform } from "@rivus/agent-kit-testing/public";
import { readUsageHome } from "./support.js";

// Ported from presence's scanner tests, on synthetic sessions laid out as in each agent's home under `/u/me`.

const home = await readUsageHome("/u/me");
const platform = createMemoryPlatform({ files: home, home: "/u/me" });
const since = Date.parse("2026-01-01T00:00:00.000Z");
const until = Date.parse("2026-01-03T00:00:00.000Z");

async function decode(
  agent: CodingAgentId,
  path: string,
  options: DecodeUsageOptions = { since, until }
): Promise<UsageRecord[]> {
  const records: UsageRecord[] = [];
  // The fixture sessions are complete, so their last open requests are reported too.
  for await (const item of decodeUsage(
    platform,
    agent,
    { path: `/u/me/${path}` },
    { ...options, final: true, providers: { usage: testUsage, identity: testIdentity } }
  )) {
    if (!isUsageRecord(item)) {
      throw new Error(`${path}: ${JSON.stringify(item.error)}`);
    }
    records.push(item);
  }
  return records;
}

const total = (records: readonly UsageRecord[]): Usage =>
  records.reduce<Usage>((sum, record) => addUsage(sum, record.usage), {});

describe("codex usage", () => {
  const rollout = (name: string) => `.codex/sessions/2026/01/01/rollout-2026-01-01T${name}.jsonl`;

  it("diffs cumulative totals, skips repeated totals, and prefers token_usage_record once it appears", async () => {
    const records = await decode("codex", rollout("00-00-00-cx-totals"));
    expect(records.map((record) => record.usage)).toEqual([
      { inputTokens: 1000, outputTokens: 50, totalTokens: 1050, cacheReadTokens: 200 },
      { inputTokens: 1000, outputTokens: 70, totalTokens: 1070, cacheReadTokens: 200 },
      { inputTokens: 800, outputTokens: 30, totalTokens: 830, cacheReadTokens: 0 },
      {
        inputTokens: 300,
        outputTokens: 9,
        totalTokens: 309,
        cacheReadTokens: 100,
        cacheWriteTokens: 0,
        reasoningTokens: 4
      }
    ]);
    expect(records[3]?.responseId).toBe("resp-1");
    expect(records.every((record) => record.model === "gpt-test" && record.sessionId === "cx-totals")).toBe(true);
  });

  it("bills the priority service tier twice, from the thread settings in force", async () => {
    const records = await decode("codex", rollout("00-00-00-cx-totals"));
    expect(records.map((record) => record.pricingMultiplier)).toEqual([2, 2, 2, undefined]);
  });

  it("takes thread settings without a service tier as the standard tier", async () => {
    const path = "/u/me/.codex/sessions/r.jsonl";
    const record = (type: string, payload: Record<string, unknown>) =>
      JSON.stringify({ timestamp: "2026-01-01T00:00:00.000Z", type, payload });
    const settings = (thread_settings: Record<string, unknown>) =>
      record("event_msg", { type: "thread_settings_applied", thread_settings });
    const usage = (response_id: string) =>
      record("token_usage_record", { response_id, usage: { input_tokens: 1, output_tokens: 1 } });
    const lines = [settings({ service_tier: "priority" }), usage("r1"), settings({ model: "gpt-test" }), usage("r2")];
    const local = createMemoryPlatform({ files: { [path]: `${lines.join("\n")}\n` } });
    const multipliers: (number | undefined)[] = [];
    for await (const item of decodeUsage(
      local,
      "codex",
      { path },
      { final: true, providers: { usage: testUsage, identity: testIdentity } }
    )) {
      multipliers.push(isUsageRecord(item) ? item.pricingMultiplier : -1);
    }
    expect(multipliers).toEqual([2, undefined]);
  });

  it("skips a forked rollout's replay of its parent and counts only its own usage", async () => {
    const records = await decode("codex", rollout("00-10-00-cx-fork"));
    expect(records.map((record) => record.usage)).toEqual([
      { inputTokens: 40, outputTokens: 10, totalTokens: 50, cacheReadTokens: 10 }
    ]);
  });

  it("keeps the cumulative baseline of records before the window", async () => {
    const records = await decode("codex", rollout("00-20-00-cx-edge"));
    expect(total(records).inputTokens).toBe(500);
  });
});
