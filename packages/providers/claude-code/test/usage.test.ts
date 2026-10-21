import { claudeCodeUsageDecoder } from "../src/usage.js";
const testUsage = { "claude-code": claudeCodeUsageDecoder };
import { claudeCode } from "../src/identity.js";
const testIdentity = { "claude-code": claudeCode };
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

describe("claude-code usage", () => {
  it("keeps one record per request with its largest usage, adding the cache back into input", async () => {
    const records = await decode("claude-code", ".claude/projects/-u-me-work/s-usage.jsonl");
    expect(records.map((record) => record.requestId ?? record.responseId)).toEqual([
      "req-1",
      "msg-gw",
      "req-2",
      "req-side"
    ]);
    expect(records[0]).toEqual({
      agent: "claude-code",
      sessionId: "s-usage",
      granularity: "request",
      requestId: "req-1",
      responseId: "msg-1",
      model: "claude-test",
      timestamp: Date.parse("2026-01-01T00:00:01.000Z"),
      usage: {
        inputTokens: 115,
        outputTokens: 20,
        totalTokens: 135,
        cacheReadTokens: 100,
        cacheWriteTokens: 5,
        cacheWrite1hTokens: 3,
        reasoningTokens: 4
      },
      source: expect.objectContaining({ file: "/u/me/.claude/projects/-u-me-work/s-usage.jsonl", line: 2 })
    });
  });

  it("counts a message behind a gateway without request id, but no synthetic message", async () => {
    const records = await decode("claude-code", ".claude/projects/-u-me-work/s-usage.jsonl");
    expect(records[1]).toMatchObject({ responseId: "msg-gw", model: "gateway-model", usage: { inputTokens: 7 } });
    expect(records[1]?.requestId).toBeUndefined();
    expect(records.some((record) => record.model === "<synthetic>")).toBe(false);
  });

  it("takes the one-hour cache breakdown as the cache write count when the flat count is 0", async () => {
    const records = await decode("claude-code", ".claude/projects/-u-me-work/s-usage.jsonl");
    expect(records[2]?.usage).toEqual({
      inputTokens: 2103,
      outputTokens: 0,
      totalTokens: 2103,
      cacheReadTokens: 0,
      cacheWriteTokens: 2103,
      cacheWrite1hTokens: 2103
    });
  });

  it("names the lane of a sidechain record and of a subagent file", async () => {
    const main = await decode("claude-code", ".claude/projects/-u-me-work/s-usage.jsonl");
    expect(main[3]?.agentLaneId).toBe("sidechain");
    const [helper] = await decode("claude-code", ".claude/projects/-u-me-work/s-usage/subagents/agent-helper.jsonl");
    expect(helper).toMatchObject({ sessionId: "s-usage", agentLaneId: "helper", requestId: "req-h" });
  });

  it("leaves out a request before `since` and keeps it without a window", async () => {
    const all = await decode("claude-code", ".claude/projects/-u-me-work/s-usage.jsonl", {});
    expect(all.map((record) => record.requestId ?? record.responseId)).toContain("req-old");
  });
});
