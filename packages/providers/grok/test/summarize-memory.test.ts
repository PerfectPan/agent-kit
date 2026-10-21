import {
  SMALL_TURNS,
  LARGE_TURNS,
  timestamp,
  promptText,
  gc,
  withSampledReads
} from "../../../testing/test/memory-support.js";
import { grokSessionAdapter } from "../src/sessions.js";
import { grok } from "../src/identity.js";

import { type SessionPlatform, loadTranscript, summarizeSession } from "@rivus/agent-kit-sessions/public";
import { describe, expect, it } from "vite-plus/test";

import { createMemoryPlatform } from "@rivus/agent-kit-testing/public";

const testSessions = { grok: grokSessionAdapter };
const builtinSessionAdapters = testSessions;
const testIdentity = { grok };

describe("summarizeSession memory", () => {
  const prompts = { limit: 200, maxChars: 500 };
  it("summarizes a growing grok session without holding its transcript", async () => {
    /** One turn: a 40 KB prompt, a short answer and its turn summary — Grok logs usage once per turn. */
    const grokContent = (turns: number): string => {
      const lines: string[] = [];
      for (let turn = 0; turn < turns; turn++) {
        lines.push(
          `{"method":"session/update","timestamp":"${timestamp(turn)}","params":{"update":{"sessionUpdate":"user_message_chunk","content":{"type":"text","text":"${promptText(turn)}"},"_meta":{"promptIndex":${turn},"modelId":"grok-test"}}}}`,
          `{"method":"session/update","timestamp":"${timestamp(turn)}","params":{"update":{"sessionUpdate":"agent_message_chunk","content":{"type":"text","text":"answer ${turn}"}}}}`,
          `{"method":"session/update","timestamp":"${timestamp(turn)}","params":{"update":{"sessionUpdate":"turn_completed","prompt_id":"p-${turn}","stop_reason":"end_turn","elapsed_ms":${100 + turn},"usage":{"inputTokens":${1000 + turn},"outputTokens":50,"totalTokens":${1050 + turn},"modelCalls":1,"modelUsage":{"grok-test":{"inputTokens":${1000 + turn},"outputTokens":50,"totalTokens":${1050 + turn},"modelCalls":1}}}}}}`
        );
      }
      return `${lines.join("\n")}\n`;
    };
    const files = createMemoryPlatform({
      files: {
        "/grok/small/updates.jsonl": grokContent(SMALL_TURNS),
        "/grok/small/summary.json": '{"chat_format_version":1,"info":{"id":"small"}}',
        "/grok/large/updates.jsonl": grokContent(LARGE_TURNS),
        "/grok/large/summary.json": '{"chat_format_version":1,"info":{"id":"large"}}'
      }
    });
    const adapter = builtinSessionAdapters.grok!;
    const peakDuring = async (run: (sampled: SessionPlatform) => Promise<unknown>): Promise<number> => {
      gc();
      await new Promise((resolve) => setImmediate(resolve));
      const before = process.memoryUsage().heapUsed;
      const peak = { value: before };
      await run(withSampledReads(files, peak));
      return peak.value - before;
    };
    await peakDuring((sampled) =>
      loadTranscript(
        sampled,
        { agent: adapter.agent, path: "/grok/small/updates.jsonl" },
        { providers: { sessions: testSessions, identity: testIdentity } }
      )
    );
    await peakDuring((sampled) =>
      summarizeSession(
        sampled,
        { agent: adapter.agent, path: "/grok/small/updates.jsonl" },
        { prompts, providers: { sessions: testSessions, identity: testIdentity } }
      )
    );
    for (let round = 1; round <= 5; round++) {
      const loadSmall = await peakDuring((sampled) =>
        loadTranscript(
          sampled,
          { agent: adapter.agent, path: "/grok/small/updates.jsonl" },
          { providers: { sessions: testSessions, identity: testIdentity } }
        )
      );
      const passSmall = await peakDuring((sampled) =>
        summarizeSession(
          sampled,
          { agent: adapter.agent, path: "/grok/small/updates.jsonl" },
          { prompts, providers: { sessions: testSessions, identity: testIdentity } }
        )
      );
      const loadLarge = await peakDuring((sampled) =>
        loadTranscript(
          sampled,
          { agent: adapter.agent, path: "/grok/large/updates.jsonl" },
          { providers: { sessions: testSessions, identity: testIdentity } }
        )
      );
      const passLarge = await peakDuring((sampled) =>
        summarizeSession(
          sampled,
          { agent: adapter.agent, path: "/grok/large/updates.jsonl" },
          { prompts, providers: { sessions: testSessions, identity: testIdentity } }
        )
      );
      const megabytes = (bytes: number): string => `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
      console.log(
        `grok round ${round}: load ${megabytes(loadSmall)} -> ${megabytes(loadLarge)}, summarize ${megabytes(passSmall)} -> ${megabytes(passLarge)}`
      );
      expect(loadLarge, `grok round ${round}: load should grow with the session`).toBeGreaterThan(loadSmall * 4);
      expect(loadLarge, `grok round ${round}: load should hold the large transcript`).toBeGreaterThan(8 * 1024 * 1024);
      expect(passLarge, `grok round ${round}: the fast pass should not materialize the transcript`).toBeLessThan(
        1024 * 1024
      );
      expect(passLarge, `grok round ${round}: the fast pass should stay far below the load`).toBeLessThan(
        loadLarge / 5
      );
    }
  }, 300_000);

  it("summarizes a time-less grok session without buffering it", async () => {
    // The same turns with no `timestamp` on any record. A time merge buffers a file until its first known time —
    // here the whole rollout — while the pass reads no times and holds one record at a time.
    const timeLessContent = (turns: number): string => {
      const lines: string[] = [];
      for (let turn = 0; turn < turns; turn++) {
        lines.push(
          `{"method":"session/update","params":{"update":{"sessionUpdate":"user_message_chunk","content":{"type":"text","text":"${promptText(turn)}"},"_meta":{"promptIndex":${turn},"modelId":"grok-test"}}}}`,
          `{"method":"session/update","params":{"update":{"sessionUpdate":"agent_message_chunk","content":{"type":"text","text":"answer ${turn}"}}}}`,
          `{"method":"session/update","params":{"update":{"sessionUpdate":"turn_completed","prompt_id":"p-${turn}","stop_reason":"end_turn","elapsed_ms":${100 + turn},"usage":{"inputTokens":${1000 + turn},"outputTokens":50,"totalTokens":${1050 + turn},"modelCalls":1,"modelUsage":{"grok-test":{"inputTokens":${1000 + turn},"outputTokens":50,"totalTokens":${1050 + turn},"modelCalls":1}}}}}}`
        );
      }
      return `${lines.join("\n")}\n`;
    };
    const files = createMemoryPlatform({
      files: {
        "/grok/time-less/updates.jsonl": timeLessContent(LARGE_TURNS),
        "/grok/time-less/summary.json": '{"chat_format_version":1,"info":{"id":"time-less"}}'
      }
    });
    const adapter = builtinSessionAdapters.grok!;
    const peakDuring = async (run: (sampled: SessionPlatform) => Promise<unknown>): Promise<number> => {
      gc();
      await new Promise((resolve) => setImmediate(resolve));
      const before = process.memoryUsage().heapUsed;
      const peak = { value: before };
      await run(withSampledReads(files, peak));
      return peak.value - before;
    };
    // A warm-up round pays for JIT and module warm-up, which would otherwise land in the measured round.
    await peakDuring((sampled) =>
      summarizeSession(
        sampled,
        { agent: adapter.agent, path: "/grok/time-less/updates.jsonl" },
        { prompts, providers: { sessions: testSessions, identity: testIdentity } }
      )
    );
    const passLarge = await peakDuring((sampled) =>
      summarizeSession(
        sampled,
        { agent: adapter.agent, path: "/grok/time-less/updates.jsonl" },
        { prompts, providers: { sessions: testSessions, identity: testIdentity } }
      )
    );
    const loadLarge = await peakDuring((sampled) =>
      loadTranscript(
        sampled,
        { agent: adapter.agent, path: "/grok/time-less/updates.jsonl" },
        { providers: { sessions: testSessions, identity: testIdentity } }
      )
    );
    const megabytes = (bytes: number): string => `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    console.log(`grok time-less: load ${megabytes(loadLarge)}, summarize ${megabytes(passLarge)}`);
    expect(loadLarge, "load should hold the large transcript").toBeGreaterThan(8 * 1024 * 1024);
    expect(passLarge, "the fast pass should not buffer the time-less file").toBeLessThan(1024 * 1024);
  }, 300_000);
});
