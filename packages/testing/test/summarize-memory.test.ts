import { SMALL_TURNS, LARGE_TURNS, timestamp, promptText, gc, withSampledReads } from "./memory-support.js";
import { builtinSessionAdapters as testSessions } from "./providers.js";
import { builtinCodingAgents as testIdentity } from "./providers.js";

import { loadTranscript, summarizeSession } from "@rivus/agent-kit-sessions";
import { describe, expect, it } from "vite-plus/test";

import { createMemoryPlatform } from "../src/memory-platform.js";

/** A Codex rollout whose turns are one 40 KB prompt, its reply and one usage record. */
function codexSessionContent(turns: number): string {
  const lines: string[] = [`{"timestamp":"${timestamp(0)}","type":"session_meta","payload":{"id":"s-big"}}`];
  for (let turn = 0; turn < turns; turn++) {
    lines.push(
      `{"timestamp":"${timestamp(turn)}","type":"response_item","payload":{"type":"message","role":"user","content":[{"type":"input_text","text":"${promptText(turn)}"}]}}`,
      `{"timestamp":"${timestamp(turn)}","type":"response_item","payload":{"type":"message","role":"assistant","content":[{"type":"output_text","text":"answer ${turn}"}]}}`,
      `{"timestamp":"${timestamp(turn)}","type":"token_usage_record","payload":{"response_id":"r-${turn}","usage":{"input_tokens":${1000 + turn},"output_tokens":50}}}`
    );
  }
  return `${lines.join("\n")}\n`;
}

describe("summarizeSession memory", () => {
  const prompts = { limit: 200, maxChars: 500 };

  it("summarizes a growing Codex rollout without holding its records", async () => {
    const files = createMemoryPlatform({
      files: {
        "/codex/small/rollout.jsonl": codexSessionContent(SMALL_TURNS),
        "/codex/large/rollout.jsonl": codexSessionContent(LARGE_TURNS)
      }
    });
    const agent = "codex" as const;
    const peakDuring = async (path: string, summarize: boolean): Promise<number> => {
      gc();
      await new Promise((resolve) => setImmediate(resolve));
      const before = process.memoryUsage().heapUsed;
      const peak = { value: before };
      const sampled = withSampledReads(files, peak);
      if (summarize) {
        await summarizeSession(
          sampled,
          { agent, path },
          { prompts, providers: { sessions: testSessions, identity: testIdentity } }
        );
      } else {
        await loadTranscript(
          sampled,
          { agent, path },
          { providers: { sessions: testSessions, identity: testIdentity } }
        );
      }
      return peak.value - before;
    };
    // A warm-up round: the first parse of a rollout pays for JIT and module warm-up, which would otherwise land in
    // the first measured round.
    await peakDuring("/codex/small/rollout.jsonl", false);
    await peakDuring("/codex/small/rollout.jsonl", true);
    for (let round = 1; round <= 5; round++) {
      const loadSmall = await peakDuring("/codex/small/rollout.jsonl", false);
      const passSmall = await peakDuring("/codex/small/rollout.jsonl", true);
      const loadLarge = await peakDuring("/codex/large/rollout.jsonl", false);
      const passLarge = await peakDuring("/codex/large/rollout.jsonl", true);
      const megabytes = (bytes: number): string => `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
      console.log(
        `round ${round}: load ${megabytes(loadSmall)} -> ${megabytes(loadLarge)}, summarize ${megabytes(passSmall)} -> ${megabytes(passLarge)}`
      );
      expect(loadLarge, `round ${round}: load should grow with the rollout`).toBeGreaterThan(loadSmall * 4);
      expect(loadLarge, `round ${round}: load should hold the large rollout`).toBeGreaterThan(8 * 1024 * 1024);
      expect(passLarge, `round ${round}: the fast pass should not materialize the rollout`).toBeLessThan(1024 * 1024);
      expect(passLarge, `round ${round}: the fast pass should stay far below the load`).toBeLessThan(loadLarge / 5);
    }
  }, 300_000);
});
