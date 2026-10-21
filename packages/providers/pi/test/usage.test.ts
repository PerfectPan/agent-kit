import { describe, expect, it } from "vite-plus/test";
import { isUsageRecord, type DecodeUsageOptions, type UsageRecord } from "@rivus/agent-kit-sessions/public";
import { createMemoryPlatform } from "@rivus/agent-kit-testing/public";
import { piUsageDecoder } from "../src/usage.js";
import { readUsageHome } from "./support.js";

const platform = createMemoryPlatform({ files: await readUsageHome("/u/me"), home: "/u/me" });
const since = Date.parse("2026-01-01T00:00:00.000Z");
const until = Date.parse("2026-01-03T00:00:00.000Z");
async function decode(
  _agent: string,
  path: string,
  options: DecodeUsageOptions = { since, until }
): Promise<UsageRecord[]> {
  const records: UsageRecord[] = [];
  for await (const item of piUsageDecoder.decode(platform, { path: `/u/me/${path}` }, { ...options, final: true })) {
    if (!isUsageRecord(item)) {
      throw new Error(`${path}: ${JSON.stringify(item.error)}`);
    }
    records.push(item);
  }
  return records;
}

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
