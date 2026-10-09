import { describe, expect, it } from "vite-plus/test";

import { type Line, splitLines, type SplitLinesOptions } from "./lines.js";

const encoder = new TextEncoder();

async function* stream(parts: readonly Uint8Array[]): AsyncGenerator<Uint8Array> {
  for (const part of parts) {
    yield part;
  }
}

async function split(parts: readonly (string | Uint8Array)[], options?: SplitLinesOptions): Promise<Line[]> {
  const bytes = parts.map((part) => (typeof part === "string" ? encoder.encode(part) : part));
  const lines: Line[] = [];
  for await (const line of splitLines(stream(bytes), options)) {
    lines.push(line);
  }
  return lines;
}

/** Every way to cut `bytes` into two chunks, plus one chunk per byte. */
function chunkings(bytes: Uint8Array): Uint8Array[][] {
  const cuts = Array.from({ length: bytes.byteLength + 1 }, (_, at) => [bytes.slice(0, at), bytes.slice(at)]);
  return [...cuts, Array.from(bytes, (byte) => Uint8Array.of(byte))];
}

describe("splitLines", () => {
  it("reports text, byte offset, byte length, line number and terminator for LF lines", async () => {
    expect(await split(["ab\ncde\n"])).toEqual([
      { text: "ab", offset: 0, byteLength: 2, lineNumber: 1, terminator: "\n" },
      { text: "cde", offset: 3, byteLength: 3, lineNumber: 2, terminator: "\n" }
    ]);
  });

  it("strips CRLF, including a CR and LF that arrive in different chunks", async () => {
    expect(await split(["a\r\nb\r", "\nc"])).toEqual([
      { text: "a", offset: 0, byteLength: 1, lineNumber: 1, terminator: "\r\n" },
      { text: "b", offset: 3, byteLength: 1, lineNumber: 2, terminator: "\r\n" },
      { text: "c", offset: 6, byteLength: 1, lineNumber: 3, terminator: "" }
    ]);
  });

  it("emits a final line without a newline as unterminated and keeps a lone CR as content", async () => {
    expect(await split(["one\ntwo\r"])).toEqual([
      { text: "one", offset: 0, byteLength: 3, lineNumber: 1, terminator: "\n" },
      { text: "two\r", offset: 4, byteLength: 4, lineNumber: 2, terminator: "" }
    ]);
  });

  it("keeps empty lines and emits nothing for an empty stream", async () => {
    expect(await split([])).toEqual([]);
    expect(await split(["", ""])).toEqual([]);
    expect((await split(["\n\nx\n"])).map(({ text, offset }) => [text, offset])).toEqual([
      ["", 0],
      ["", 1],
      ["x", 2]
    ]);
  });

  it("decodes multi-byte characters split across chunks and counts their bytes", async () => {
    const bytes = encoder.encode("é😀\nß");
    const lines = await split([bytes.subarray(0, 1), bytes.subarray(1, 4), bytes.subarray(4)]);
    expect(lines).toEqual([
      { text: "é😀", offset: 0, byteLength: 6, lineNumber: 1, terminator: "\n" },
      { text: "ß", offset: 7, byteLength: 2, lineNumber: 2, terminator: "" }
    ]);
  });

  it("produces the same lines for every chunking, and each line's bytes decode to its text", async () => {
    const source = encoder.encode('{"a":"é"}\r\n\n😀 x\n\uFEFFlast');
    const expected = await split([source]);
    expect(expected.map((line) => line.text)).toEqual(['{"a":"é"}', "", "😀 x", "\uFEFFlast"]);
    for (const parts of chunkings(source)) {
      expect(await split(parts)).toEqual(expected);
    }
    let next = 0;
    for (const line of expected) {
      expect(line.offset).toBe(next);
      const bytes = source.subarray(line.offset, line.offset + line.byteLength);
      expect(new TextDecoder("utf-8", { ignoreBOM: true }).decode(bytes)).toBe(line.text);
      next = line.offset + line.byteLength + line.terminator.length;
    }
    expect(next).toBe(source.byteLength);
  });

  it("drops a byte order mark only at source offset 0 and keeps U+FEFF elsewhere", async () => {
    const withBom = encoder.encode("\uFEFFx\r\ny");
    const expected = [
      { text: "x", offset: 3, byteLength: 1, lineNumber: 1, terminator: "\r\n" },
      { text: "y", offset: 6, byteLength: 1, lineNumber: 2, terminator: "" }
    ];
    for (const parts of chunkings(withBom)) {
      expect(await split(parts)).toEqual(expected);
    }
    expect(await split(["a\n\uFEFFb\n"])).toEqual([
      { text: "a", offset: 0, byteLength: 1, lineNumber: 1, terminator: "\n" },
      { text: "\uFEFFb", offset: 2, byteLength: 4, lineNumber: 2, terminator: "\n" }
    ]);
    expect(await split(["\uFEFFz"], { startOffset: 10 })).toEqual([
      { text: "\uFEFFz", offset: 10, byteLength: 4, lineNumber: 1, terminator: "" }
    ]);
  });

  it("keeps a partial line intact when the producer reuses one Node Buffer", async () => {
    // Node's Buffer#slice returns a view of the same memory, unlike Uint8Array#slice.
    const { Buffer } = globalThis as unknown as { Buffer: { alloc(size: number): Uint8Array } };
    const reused = Buffer.alloc(2);
    async function* producer(): AsyncGenerator<Uint8Array> {
      for (const part of ["ab", "c\n"]) {
        reused.set(encoder.encode(part));
        yield reused;
      }
    }
    const texts: string[] = [];
    for await (const line of splitLines(producer())) {
      texts.push(line.text);
    }
    expect(texts).toEqual(["abc"]);
  });

  it("continues offsets and line numbers for a stream that starts mid-file", async () => {
    expect(await split(["x\ny"], { startOffset: 100, startLine: 7 })).toEqual([
      { text: "x", offset: 100, byteLength: 1, lineNumber: 7, terminator: "\n" },
      { text: "y", offset: 102, byteLength: 1, lineNumber: 8, terminator: "" }
    ]);
  });

  it("closes the source when the consumer stops early", async () => {
    let closed = false;
    async function* source(): AsyncGenerator<Uint8Array> {
      try {
        yield encoder.encode("a\nb\n");
        yield encoder.encode("c\n");
      } finally {
        closed = true;
      }
    }
    for await (const line of splitLines(source())) {
      expect(line.text).toBe("a");
      break;
    }
    expect(closed).toBe(true);
  });
});
