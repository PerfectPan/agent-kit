import { builtinUsageDecoders as testUsage } from "./providers.js";
import { builtinCodingAgents as testIdentity } from "./providers.js";
import type { CodingAgentId } from "@rivus/agent-kit-catalog";
import {
  decodeUsage,
  type DecodeUsageOptions,
  isUsageRecord,
  noCacheInputTokens,
  type UsageRecord
} from "@rivus/agent-kit-sessions";
import { describe, expect, it } from "vite-plus/test";

import { createMemoryPlatform } from "../src/memory-platform.js";
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

describe("ccusage buckets", () => {
  // presence and ccusage price four disjoint buckets: input without cache, cache reads, cache writes and output.
  // The kit's convention has input include the cache, and `noCacheInputTokens` gives the first bucket back, so a
  // cached token is never charged at the input rate as well.
  const buckets = (record: UsageRecord | undefined) => {
    const usage = record?.usage ?? {};
    return [noCacheInputTokens(usage), usage.cacheReadTokens ?? 0, usage.cacheWriteTokens ?? 0, usage.outputTokens];
  };

  it.each([
    ["claude-code", ".claude/projects/-u-me-work/s-usage.jsonl", [10, 100, 5, 20]],
    ["codex", ".codex/sessions/2026/01/01/rollout-2026-01-01T00-00-00-cx-totals.jsonl", [800, 200, 0, 50]],
    ["opencode", ".local/share/opencode/storage/message/ses_legacy", [100, 50, 0, 25]],
    ["pi", ".pi/agent/sessions/--u-me-work--/2026-01-01T00-00-00-000Z_pi-1.jsonl", [11349, 1024, 0, 4]],
    // presence leaves Gemini's tool-use prompt tokens (10 here) out of every bucket; they are input.
    ["gemini-cli", ".gemini/tmp/projhash/chats/session-2026-01-01T00-00-gm1.jsonl", [710, 300, 0, 250]]
  ] as const)("%s matches presence's buckets for the first record", async (agent, path, expected) => {
    expect(buckets((await decode(agent, path, {}))[0])).toEqual(expected);
  });
});
