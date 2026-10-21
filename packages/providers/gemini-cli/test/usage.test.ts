import { describe, expect, it } from "vite-plus/test";
import { decodeUsage, isUsageRecord, type DecodeUsageOptions, type UsageRecord } from "@rivus/agent-kit-sessions";
import { createMemoryPlatform } from "@rivus/agent-kit-testing";
import { geminiCli } from "../src/identity.js";
import { geminiCliUsageDecoder } from "../src/usage.js";
import { readUsageHome } from "./support.js";

const platform = createMemoryPlatform({ files: await readUsageHome("/u/me"), home: "/u/me" });
const since = Date.parse("2026-01-01T00:00:00.000Z");
const until = Date.parse("2026-01-03T00:00:00.000Z");
async function decode(
  agent: string,
  path: string,
  options: DecodeUsageOptions = { since, until }
): Promise<UsageRecord[]> {
  const records: UsageRecord[] = [];
  for await (const item of decodeUsage(
    platform,
    agent,
    { path: `/u/me/${path}` },
    {
      ...options,
      final: true,
      providers: { usage: { "gemini-cli": geminiCliUsageDecoder }, identity: { "gemini-cli": geminiCli } }
    }
  )) {
    if (!isUsageRecord(item)) {
      throw new Error(`${path}: ${JSON.stringify(item.error)}`);
    }
    records.push(item);
  }
  return records;
}

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
