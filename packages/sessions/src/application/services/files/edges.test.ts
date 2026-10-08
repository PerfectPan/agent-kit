import { describe, expect, it } from "vitest";

import type { SessionPlatform } from "../../ports.js";
import { EDGE_BYTES, edgeRecords, readEdges } from "./edges.js";

function bytesPlatform(file: Uint8Array, reads: { start: number; end: number }[] = []): SessionPlatform {
  return {
    fs: {
      async stat() {
        return { kind: "file", size: file.length, mtimeMs: 0 };
      },
      async list() {
        return [];
      },
      async *read(_path, range) {
        const start = range?.start ?? 0;
        const end = range?.end ?? file.length;
        reads.push({ start, end });
        yield file.slice(start, end);
      }
    }
  };
}

function paddedLine(n: number, bytes: number): string {
  const base = `{"n":${n},"pad":""}`;
  return `{"n":${n},"pad":"${"x".repeat(bytes - 1 - base.length)}"}`;
}

/** JSONL lines of `{"n":i,"pad":"…"}` up to `size` bytes; one line ends exactly at byte `boundary`. */
function jsonl(size: number, boundary: number): { file: Uint8Array; count: number } {
  const lines: string[] = [];
  let length = 0;
  for (; length + 1000 <= boundary; length += 1000) {
    lines.push(paddedLine(lines.length, 1000));
  }
  lines.push(paddedLine(lines.length, boundary - length));
  for (length = boundary; length + 1000 <= size; length += 1000) {
    lines.push(paddedLine(lines.length, 1000));
  }
  return { file: new TextEncoder().encode(`${lines.join("\n")}\n`), count: lines.length };
}

describe("readEdges", () => {
  it("reads 64 KB from each end when the file is between 64 KB and 128 KB", async () => {
    const { file } = jsonl(90 * 1024, EDGE_BYTES);
    const reads: { start: number; end: number }[] = [];
    const edges = await readEdges(bytesPlatform(file, reads), "session.jsonl");
    expect(edges?.whole).toBe(false);
    expect(reads).toEqual([
      { start: 0, end: EDGE_BYTES },
      { start: file.length - EDGE_BYTES, end: file.length }
    ]);
  });

  it("keeps every line of a 90 KB file whose line boundary is exactly at 64 KB", async () => {
    const { file, count } = jsonl(90 * 1024, EDGE_BYTES);
    expect(new TextDecoder().decode(file.subarray(0, EDGE_BYTES)).endsWith("\n")).toBe(true);
    const edges = await readEdges(bytesPlatform(file), "session.jsonl");
    expect(edgeRecords(edges!).map((record) => record.n)).toEqual(Array.from({ length: count }, (_, index) => index));
  });

  it("drops the partial first line of a tail that does not overlap the head", async () => {
    const { file, count } = jsonl(300 * 1024, 100 * 1024);
    const numbers = edgeRecords((await readEdges(bytesPlatform(file), "session.jsonl"))!).map((record) => record.n);
    expect(numbers[0]).toBe(0);
    expect(numbers.at(-1)).toBe(count - 1);
    expect(numbers).toEqual(numbers.toSorted((a, b) => Number(a) - Number(b)));
  });

  it("reads a file of at most 64 KB once", async () => {
    const reads: { start: number; end: number }[] = [];
    const edges = await readEdges(bytesPlatform(new TextEncoder().encode('{"n":0}\n'), reads), "session.jsonl");
    expect(edges?.whole).toBe(true);
    expect(reads).toEqual([{ start: 0, end: 8 }]);
    expect(edgeRecords(edges!)).toEqual([{ n: 0 }]);
  });
});

describe("readEdges cancellation", () => {
  it("does not start the tail read when the signal aborts at the end of the head", async () => {
    const controller = new AbortController();
    const { file } = jsonl(90 * 1024, EDGE_BYTES);
    const reads: { start: number; end: number }[] = [];
    const platform = bytesPlatform(file, reads);
    const read = platform.fs.read;
    const aborting: SessionPlatform = {
      fs: {
        ...platform.fs,
        async *read(path, range) {
          yield* read(path, range);
          controller.abort(new Error("stop"));
        }
      }
    };
    await expect(readEdges(aborting, "session.jsonl", { signal: controller.signal })).rejects.toThrow("stop");
    expect(reads).toEqual([{ start: 0, end: EDGE_BYTES }]);
  });
});
