import v8 from "node:v8";
import vm from "node:vm";
import type { SessionPlatform } from "@rivus/agent-kit-sessions";
// A session whose turns are one 40 KB prompt, one request and one turn duration: memory-hungry for a reader that
// materializes the transcript, while the summary pass's own state — the numbers per request — stays a few bytes a
// turn. The big session is ~16 MB, the small one ~2 MB.
export const TURN_TEXT_BYTES = 40 * 1024;
export const SMALL_TURNS = 48;
export const LARGE_TURNS = 384;

export function timestamp(turn: number): string {
  const total = turn * 2;
  const at = (value: number): string => String(value).padStart(2, "0");
  return `2026-01-01T${at(Math.floor(total / 3600))}:${at(Math.floor(total / 60) % 60)}:${at(total % 60)}.000Z`;
}

export function promptText(turn: number): string {
  const chunk = `turn ${turn} the quick brown fox jumps over the lazy dog `;
  return chunk.repeat(Math.ceil(TURN_TEXT_BYTES / chunk.length)).slice(0, TURN_TEXT_BYTES);
}

/** `gc` comes from `v8.setFlagsFromString` because the test runner does not start Node with `--expose-gc`. */
export const gc = (() => {
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
export function withSampledReads(inner: SessionPlatform, peak: { value: number }): SessionPlatform {
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
