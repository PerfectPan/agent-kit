import type { CodingAgentId } from "@rivus/agent-kit-catalog";
import {
  addUsage,
  decodeUsage,
  type DecodeUsageOptions,
  isUsageRecord,
  noCacheInputTokens,
  type Usage,
  type UsageRecord
} from "@rivus/agent-kit-sessions";
import { describe, expect, it } from "vitest";

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
  for await (const item of decodeUsage(platform, agent, { path: `/u/me/${path}` }, { ...options, final: true })) {
    if (!isUsageRecord(item)) {
      throw new Error(`${path}: ${JSON.stringify(item.error)}`);
    }
    records.push(item);
  }
  return records;
}

const total = (records: readonly UsageRecord[]): Usage =>
  records.reduce<Usage>((sum, record) => addUsage(sum, record.usage), {});

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
    for await (const item of decodeUsage(local, "codex", { path }, { final: true })) {
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

describe("gemini-cli usage", () => {
  const chats = ".gemini/tmp/projhash/chats";

  it("counts a message once at its first record with tokens, with thoughts as reasoning output", async () => {
    const records = await decode("gemini-cli", `${chats}/session-2026-01-01T00-00-gm1.jsonl`);
    expect(records.map((record) => [record.sessionId, record.model, record.usage])).toEqual([
      [
        "gm-1",
        "gemini-test",
        {
          inputTokens: 1010,
          outputTokens: 250,
          totalTokens: 1260,
          cacheReadTokens: 300,
          reasoningTokens: 50
        }
      ],
      [
        "gm-1",
        "gemini-test",
        { inputTokens: 500, outputTokens: 120, totalTokens: 620, cacheReadTokens: 0, reasoningTokens: 0 }
      ]
    ]);
  });

  it("reads a subagent chat and an older single-object chat", async () => {
    expect(await decode("gemini-cli", `${chats}/gm-1/sub-1.jsonl`)).toMatchObject([
      { sessionId: "sub-1", model: "gemini-flash-test", usage: { inputTokens: 40, outputTokens: 5 } }
    ]);
    const legacy = await decode("gemini-cli", `${chats}/session-legacy.json`, {});
    expect(legacy).toMatchObject([
      { sessionId: "gm-legacy", usage: { inputTokens: 400, outputTokens: 60, cacheReadTokens: 100 } }
    ]);
    expect(legacy[0]?.source).toMatchObject({ offset: 0, line: 1 });
  });
});

describe("pi usage", () => {
  const sessions = ".pi/agent/sessions/--u-me-work--";

  it("keeps the cost Pi logged, also when it is 0, and adds the cache back into input", async () => {
    const records = await decode("pi", `${sessions}/2026-01-01T00-00-00-000Z_pi-1.jsonl`);
    expect(records).toMatchObject([
      {
        sessionId: "pi-1",
        model: "model-test",
        provider: "provider-test",
        responseId: "resp-pi-1",
        costUsd: 0,
        costSource: "agent",
        usage: {
          inputTokens: 12373,
          outputTokens: 4,
          totalTokens: 12377,
          cacheReadTokens: 1024,
          cacheWriteTokens: 0,
          reasoningTokens: 1
        }
      },
      { costUsd: 0.5, usage: { inputTokens: 120, cacheWriteTokens: 20, cacheWrite1hTokens: 5 } }
    ]);
  });

  it("skips the parent's entries that a forked session starts with", async () => {
    const records = await decode("pi", `${sessions}/2026-01-02T00-00-00-000Z_pi-fork.jsonl`, {});
    expect(records.map((record) => [record.sessionId, record.responseId])).toEqual([["pi-fork", "resp-pi-fork"]]);
  });
});

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

describe("opencode usage (older JSON layout)", () => {
  it("reads each message file of a session, with the logged cost and reasoning folded into output", async () => {
    const records = await decode("opencode", ".local/share/opencode/storage/message/ses_legacy", {});
    expect(records.map((record) => [record.sessionId, record.usage, record.costUsd])).toEqual([
      [
        "ses_legacy",
        {
          inputTokens: 150,
          outputTokens: 25,
          totalTokens: 175,
          cacheReadTokens: 50,
          cacheWriteTokens: 0,
          reasoningTokens: 5
        },
        0.01
      ],
      [
        "ses_legacy",
        {
          inputTokens: 3,
          outputTokens: 0,
          totalTokens: 3,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          reasoningTokens: 0
        },
        0
      ]
    ]);
    // A message the older layout left without a completion time counts at its creation time.
    expect(records[1]?.timestamp).toBe(1767225603000);
  });
});

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
