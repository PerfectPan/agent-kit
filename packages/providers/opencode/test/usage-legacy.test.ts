import { describe, expect, it } from "vite-plus/test";
import {
  decodeUsage,
  isUsageRecord,
  type DecodeUsageOptions,
  type UsageRecord
} from "@rivus/agent-kit-sessions/public";
import { createMemoryPlatform } from "@rivus/agent-kit-testing/public";
import { opencode } from "../src/identity.js";
import { opencodeUsageDecoder } from "../src/usage.js";
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
      providers: { usage: { opencode: opencodeUsageDecoder }, identity: { opencode: opencode } }
    }
  )) {
    if (!isUsageRecord(item)) {
      throw new Error(`${path}: ${JSON.stringify(item.error)}`);
    }
    records.push(item);
  }
  return records;
}

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
