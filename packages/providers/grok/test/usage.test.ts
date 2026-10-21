import { grokUsageDecoder } from "../src/usage.js";
import { grok } from "../src/identity.js";
import type { CodingAgentId } from "@rivus/agent-kit-catalog/public";
import {
  decodeUsage,
  type DecodeUsageOptions,
  isUsageRecord,
  type UsageRecord
} from "@rivus/agent-kit-sessions/public";
import { describe, expect, it } from "vite-plus/test";

import { createMemoryPlatform } from "@rivus/agent-kit-testing/public";
import { readUsageHome } from "./support.js";

const testUsage = { grok: grokUsageDecoder };
const testIdentity = { grok };

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

describe("grok usage", () => {
  it("reports each turn with its model calls, per-model split and the cost Grok logged", async () => {
    const records = await decode("grok", ".grok/sessions/%2Fu%2Fme%2Fwork/gk-usage/updates.jsonl");
    expect(records).toHaveLength(1);
    const [turn] = records;
    expect(turn).toMatchObject({
      agent: "grok",
      sessionId: "gk-usage",
      granularity: "turn",
      modelCalls: 9,
      model: "grok-main",
      costSource: "agent",
      usage: { inputTokens: 600000, outputTokens: 20000, cacheReadTokens: 300000, reasoningTokens: 15000 }
    });
    expect(turn?.costUsd).toBeCloseTo(0.123456789, 12);
    expect(turn?.usageByModel?.["grok-mini"]).toMatchObject({ modelCalls: 1, costSource: "agent" });
    expect(turn?.usageByModel?.["grok-mini"]?.costUsd).toBeCloseTo(0.003456789, 12);
  });

  it("decodes a session given by its directory", async () => {
    expect(await decode("grok", ".grok/sessions/%2Fu%2Fme%2Fwork/gk-usage")).toHaveLength(1);
  });
});
