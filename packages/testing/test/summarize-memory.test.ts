import v8 from "node:v8";
import vm from "node:vm";

import { builtinSessionAdapters, loadTranscript, summarizeSession } from "@rivus/agent-kit-sessions";
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

/**
 * The heap the call's result holds: `heapUsed` after a forced collection before the call, against the largest read
 * over collection rounds while the result is alive. Every transient — the parsed records a materializing reader
 * built, the records a pass dropped — is collected before the base is read, and nothing can collect the result
 * while it is held, so the difference is what the result itself survives as. A reader that materializes the
 * transcript holds it; the summary pass holds only its running numbers.
 *
 * `gc` comes from `v8.setFlagsFromString` because the test runner does not start Node with `--expose-gc`. The
 * result is read on every round so liveness optimizations cannot drop it halfway through.
 */
const gc = (() => {
  v8.setFlagsFromString("--expose-gc");
  return vm.runInNewContext("gc") as () => void;
})();

const SETTLE_ROUNDS = 6;

async function retained(run: () => Promise<unknown>): Promise<number> {
  const settle = async (): Promise<void> => {
    for (let round = 0; round < SETTLE_ROUNDS; round++) {
      gc();
      await new Promise((resolve) => setImmediate(resolve));
    }
  };
  await settle();
  const before = process.memoryUsage().heapUsed;
  let keep: unknown = await run();
  // The base is the floor of the readings: the delta is then the largest the heap grew while the result was held,
  // never negative when a released transcript of an earlier call is only collected inside this one.
  let held = before;
  let nothing = 0;
  for (let round = 0; round < SETTLE_ROUNDS; round++) {
    gc();
    await new Promise((resolve) => setImmediate(resolve));
    held = Math.max(held, process.memoryUsage().heapUsed);
    // The count is read after the rounds, so the comparison cannot be hoisted out of the loop and the result stays
    // alive through it.
    if (keep === undefined) {
      nothing += 1;
    }
  }
  if (nothing > 0) {
    throw new Error("the call resolved to nothing");
  }
  return held - before;
}

describe("summarizeSession memory", () => {
  it("summarizes a growing session without holding its transcript", async () => {
    const platform = createMemoryPlatform({
      files: {
        "/claude/small/session.jsonl": sessionContent(SMALL_TURNS),
        "/claude/large/session.jsonl": sessionContent(LARGE_TURNS)
      }
    });
    const adapter = builtinSessionAdapters["claude-code"]!;
    // A warm-up round: the first parse of a session pays for JIT and module warm-up, which would otherwise land in
    // the first measured round and dwarf the difference the test judges.
    await retained(() => loadTranscript(platform, { agent: adapter.agent, path: "/claude/small/session.jsonl" }));
    await retained(() => summarizeSession(platform, { agent: adapter.agent, path: "/claude/small/session.jsonl" }));
    for (let round = 1; round <= 5; round++) {
      const loadSmall = await retained(() =>
        loadTranscript(platform, { agent: adapter.agent, path: "/claude/small/session.jsonl" })
      );
      const passSmall = await retained(() =>
        summarizeSession(platform, { agent: adapter.agent, path: "/claude/small/session.jsonl" })
      );
      const loadLarge = await retained(() =>
        loadTranscript(platform, { agent: adapter.agent, path: "/claude/large/session.jsonl" })
      );
      const passLarge = await retained(() =>
        summarizeSession(platform, { agent: adapter.agent, path: "/claude/large/session.jsonl" })
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
