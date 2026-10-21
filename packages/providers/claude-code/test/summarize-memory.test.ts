import {
  SMALL_TURNS,
  LARGE_TURNS,
  timestamp,
  promptText,
  gc,
  withSampledReads
} from "../../../testing/test/memory-support.js";
import { claudeCodeSessionAdapter } from "../src/sessions.js";
import { claudeCode } from "../src/identity.js";
import { type SessionPlatform, loadTranscript, summarizeSession } from "@rivus/agent-kit-sessions/public";
import { describe, expect, it } from "vite-plus/test";
import { createMemoryPlatform } from "@rivus/agent-kit-testing/public";
const testSessions = { "claude-code": claudeCodeSessionAdapter };
const testIdentity = { "claude-code": claudeCode };
function sessionContent(turns: number): string {
  const lines: string[] = [];
  for (let turn = 0; turn < turns; turn++) {
    lines.push(
      `{"type":"user","uuid":"u${turn}","timestamp":"${timestamp(turn)}","sessionId":"big","cwd":"/work/app","version":"2.0.0","message":{"role":"user","content":"${promptText(turn)}"}}`,
      `{"type":"assistant","uuid":"a${turn}","timestamp":"${timestamp(turn)}","sessionId":"big","cwd":"/work/app","version":"2.0.0","requestId":"req-${turn}","message":{"role":"assistant","model":"claude-test","id":"msg-${turn}","stop_reason":"end_turn","usage":{"input_tokens":${1000 + turn},"output_tokens":50},"content":[{"type":"text","text":"answer ${turn}"}]}}`,
      `{"type":"system","uuid":"d${turn}","subtype":"turn_duration","durationMs":${100 + turn},"timestamp":"${timestamp(turn)}","sessionId":"big","version":"2.0.0"}`
    );
  }
  return `${lines.join("\n")}\n`;
}

describe("summarizeSession memory", () => {
  const prompts = { limit: 200, maxChars: 500 };
  it("summarizes a growing session without holding its transcript", async () => {
    const files = createMemoryPlatform({
      files: {
        "/claude/small/session.jsonl": sessionContent(SMALL_TURNS),
        "/claude/large/session.jsonl": sessionContent(LARGE_TURNS)
      }
    });
    const adapter = testSessions["claude-code"]!;
    const peakDuring = async (run: (sampled: SessionPlatform) => Promise<unknown>): Promise<number> => {
      gc();
      await new Promise((resolve) => setImmediate(resolve));
      const before = process.memoryUsage().heapUsed;
      const peak = { value: before };
      await run(withSampledReads(files, peak));
      return peak.value - before;
    };
    // A warm-up round: the first parse of a session pays for JIT and module warm-up, which would otherwise land in
    // the first measured round.
    await peakDuring((sampled) =>
      loadTranscript(
        sampled,
        { agent: adapter.agent, path: "/claude/small/session.jsonl" },
        { providers: { sessions: testSessions, identity: testIdentity } }
      )
    );
    await peakDuring((sampled) =>
      summarizeSession(
        sampled,
        { agent: adapter.agent, path: "/claude/small/session.jsonl" },
        { prompts, providers: { sessions: testSessions, identity: testIdentity } }
      )
    );
    for (let round = 1; round <= 5; round++) {
      const loadSmall = await peakDuring((sampled) =>
        loadTranscript(
          sampled,
          { agent: adapter.agent, path: "/claude/small/session.jsonl" },
          { providers: { sessions: testSessions, identity: testIdentity } }
        )
      );
      const passSmall = await peakDuring((sampled) =>
        summarizeSession(
          sampled,
          { agent: adapter.agent, path: "/claude/small/session.jsonl" },
          { prompts, providers: { sessions: testSessions, identity: testIdentity } }
        )
      );
      const loadLarge = await peakDuring((sampled) =>
        loadTranscript(
          sampled,
          { agent: adapter.agent, path: "/claude/large/session.jsonl" },
          { providers: { sessions: testSessions, identity: testIdentity } }
        )
      );
      const passLarge = await peakDuring((sampled) =>
        summarizeSession(
          sampled,
          { agent: adapter.agent, path: "/claude/large/session.jsonl" },
          { prompts, providers: { sessions: testSessions, identity: testIdentity } }
        )
      );
      const megabytes = (bytes: number): string => `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
      console.log(
        `round ${round}: load ${megabytes(loadSmall)} -> ${megabytes(loadLarge)}, summarize ${megabytes(passSmall)} -> ${megabytes(passLarge)}`
      );
      expect(loadLarge, `round ${round}: load should grow with the session`).toBeGreaterThan(loadSmall * 4);
      expect(loadLarge, `round ${round}: load should hold the large transcript`).toBeGreaterThan(8 * 1024 * 1024);
      expect(passLarge, `round ${round}: the fast pass should not materialize the transcript`).toBeLessThan(
        1024 * 1024
      );
      expect(passLarge, `round ${round}: the fast pass should stay far below the load`).toBeLessThan(loadLarge / 5);
    }
  }, 300_000);
});
