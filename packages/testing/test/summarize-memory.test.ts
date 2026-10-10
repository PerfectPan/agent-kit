import v8 from "node:v8";
import vm from "node:vm";

import {
  builtinSessionAdapters,
  loadTranscript,
  type SessionPlatform,
  summarizeSession
} from "@rivus/agent-kit-sessions";
import { describe, expect, it } from "vite-plus/test";

import { createMemoryPlatform } from "../src/memory-platform.js";

// A session whose turns are one 40 KB prompt, one request and one turn duration: memory-hungry for a reader that
// materializes the transcript, while the summary pass's own state — the numbers per request — stays a few bytes a
// turn. The big session is ~16 MB, the small one ~2 MB.
const TURN_TEXT_BYTES = 40 * 1024;
const SMALL_TURNS = 48;
const LARGE_TURNS = 384;

function timestamp(turn: number): string {
  const total = turn * 2;
  const at = (value: number): string => String(value).padStart(2, "0");
  return `2026-01-01T${at(Math.floor(total / 3600))}:${at(Math.floor(total / 60) % 60)}:${at(total % 60)}.000Z`;
}

function promptText(turn: number): string {
  const chunk = `turn ${turn} the quick brown fox jumps over the lazy dog `;
  return chunk.repeat(Math.ceil(TURN_TEXT_BYTES / chunk.length)).slice(0, TURN_TEXT_BYTES);
}

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

/** `gc` comes from `v8.setFlagsFromString` because the test runner does not start Node with `--expose-gc`. */
const gc = (() => {
  v8.setFlagsFromString("--expose-gc");
  return vm.runInNewContext("gc") as () => void;
})();

/**
 * The platform whose reads sample the heap: at every chunk boundary the collection runs first, so transients — the
 * parsed records a materializing reader built, the records a pass dropped — are gone at each reading, and the peak
 * is what the call was holding while it ran. A reader that materializes the transcript holds it from mid-read on;
 * the summary pass holds only its running numbers. The tail after the last chunk is not sampled, which forgoes a
 * few kilobytes of the peak.
 */
function withSampledReads(inner: SessionPlatform, peak: { value: number }): SessionPlatform {
  return {
    fs: {
      stat: (path, options) => inner.fs.stat(path, options),
      list: (dir) => inner.fs.list(dir),
      async *read(path, range) {
        for await (const chunk of inner.fs.read(path, range)) {
          gc();
          peak.value = Math.max(peak.value, process.memoryUsage().heapUsed);
          yield chunk;
        }
      }
    }
  };
}

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
  it("summarizes a growing session without holding its transcript", async () => {
    const files = createMemoryPlatform({
      files: {
        "/claude/small/session.jsonl": sessionContent(SMALL_TURNS),
        "/claude/large/session.jsonl": sessionContent(LARGE_TURNS)
      }
    });
    const adapter = builtinSessionAdapters["claude-code"]!;
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
      loadTranscript(sampled, { agent: adapter.agent, path: "/claude/small/session.jsonl" })
    );
    await peakDuring((sampled) =>
      summarizeSession(sampled, { agent: adapter.agent, path: "/claude/small/session.jsonl" })
    );
    for (let round = 1; round <= 5; round++) {
      const loadSmall = await peakDuring((sampled) =>
        loadTranscript(sampled, { agent: adapter.agent, path: "/claude/small/session.jsonl" })
      );
      const passSmall = await peakDuring((sampled) =>
        summarizeSession(sampled, { agent: adapter.agent, path: "/claude/small/session.jsonl" })
      );
      const loadLarge = await peakDuring((sampled) =>
        loadTranscript(sampled, { agent: adapter.agent, path: "/claude/large/session.jsonl" })
      );
      const passLarge = await peakDuring((sampled) =>
        summarizeSession(sampled, { agent: adapter.agent, path: "/claude/large/session.jsonl" })
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
        await summarizeSession(sampled, { agent, path });
      } else {
        await loadTranscript(sampled, { agent, path });
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
    await peakDuring((sampled) => loadTranscript(sampled, { agent: adapter.agent, path: "/grok/small/updates.jsonl" }));
    await peakDuring((sampled) =>
      summarizeSession(sampled, { agent: adapter.agent, path: "/grok/small/updates.jsonl" })
    );
    for (let round = 1; round <= 5; round++) {
      const loadSmall = await peakDuring((sampled) =>
        loadTranscript(sampled, { agent: adapter.agent, path: "/grok/small/updates.jsonl" })
      );
      const passSmall = await peakDuring((sampled) =>
        summarizeSession(sampled, { agent: adapter.agent, path: "/grok/small/updates.jsonl" })
      );
      const loadLarge = await peakDuring((sampled) =>
        loadTranscript(sampled, { agent: adapter.agent, path: "/grok/large/updates.jsonl" })
      );
      const passLarge = await peakDuring((sampled) =>
        summarizeSession(sampled, { agent: adapter.agent, path: "/grok/large/updates.jsonl" })
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
      summarizeSession(sampled, { agent: adapter.agent, path: "/grok/time-less/updates.jsonl" })
    );
    const passLarge = await peakDuring((sampled) =>
      summarizeSession(sampled, { agent: adapter.agent, path: "/grok/time-less/updates.jsonl" })
    );
    const loadLarge = await peakDuring((sampled) =>
      loadTranscript(sampled, { agent: adapter.agent, path: "/grok/time-less/updates.jsonl" })
    );
    const megabytes = (bytes: number): string => `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    console.log(`grok time-less: load ${megabytes(loadLarge)}, summarize ${megabytes(passLarge)}`);
    expect(loadLarge, "load should hold the large transcript").toBeGreaterThan(8 * 1024 * 1024);
    expect(passLarge, "the fast pass should not buffer the time-less file").toBeLessThan(1024 * 1024);
  }, 300_000);
});
