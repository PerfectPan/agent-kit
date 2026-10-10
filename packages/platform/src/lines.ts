const LF = 0x0a;
const CR = 0x0d;
const BOM = [0xef, 0xbb, 0xbf];

export interface Line {
  /** Decoded content without the terminator. */
  readonly text: string;
  /** Byte offset of the first content byte in the source. */
  readonly offset: number;
  /** Encoded length of `text`, excluding the terminator; `offset + byteLength + terminator.length` is the next line. */
  readonly byteLength: number;
  /** 1-based. */
  readonly lineNumber: number;
  /** Empty for a final line that the stream ended without terminating, which a writer may still be appending to. */
  readonly terminator: "\n" | "\r\n" | "";
}

export interface SplitLinesOptions {
  /** Source offset of the first chunk, when the stream starts mid-file. */
  readonly startOffset?: number;
  readonly startLine?: number;
}

function concat(parts: Uint8Array[], length: number): Uint8Array {
  const out = new Uint8Array(length);
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.byteLength;
  }
  return out;
}

/**
 * Splits a UTF-8 byte stream into lines. Splitting happens on bytes and each line is decoded whole, so a
 * multi-byte character or a CRLF pair split across chunks is handled. A UTF-8 byte order mark is dropped only at
 * source offset 0, and the first line's `offset` then starts after it; U+FEFF anywhere else stays in `text`, so
 * `offset` and `byteLength` always address exactly the bytes of `text`. Breaking out of the loop closes `chunks`.
 */
export async function* splitLines(
  chunks: AsyncIterable<Uint8Array>,
  options: SplitLinesOptions = {}
): AsyncGenerator<Line, void, undefined> {
  const decoder = new TextDecoder("utf-8", { ignoreBOM: true });
  let offset = options.startOffset ?? 0;
  let lineNumber = options.startLine ?? 1;
  let pending: Uint8Array[] = [];
  let pendingLength = 0;

  const toLine = (bytes: Uint8Array, terminated: boolean): Line => {
    const hasCr = terminated && bytes.at(-1) === CR;
    const hasBom = offset === 0 && BOM.every((byte, at) => bytes[at] === byte);
    const content = bytes.subarray(hasBom ? BOM.length : 0, hasCr ? -1 : bytes.byteLength);
    const terminator = terminated ? (hasCr ? "\r\n" : "\n") : "";
    if (hasBom) {
      offset = BOM.length;
    }
    const line: Line = {
      text: decoder.decode(content),
      offset,
      byteLength: content.byteLength,
      lineNumber,
      terminator
    };
    offset += content.byteLength + terminator.length;
    lineNumber += 1;
    return line;
  };

  for await (const chunk of chunks) {
    let start = 0;
    let newline = chunk.indexOf(LF);
    while (newline !== -1) {
      const head = chunk.subarray(start, newline);
      const bytes = pendingLength === 0 ? head : concat([...pending, head], pendingLength + head.byteLength);
      pending = [];
      pendingLength = 0;
      yield toLine(bytes, true);
      start = newline + 1;
      newline = chunk.indexOf(LF, start);
    }
    if (start < chunk.byteLength) {
      // A producer may reuse its chunk buffer after the next pull, so copy. Buffer#slice returns a view, not a copy.
      pending.push(Uint8Array.prototype.slice.call(chunk, start));
      pendingLength += chunk.byteLength - start;
    }
  }
  if (pendingLength > 0) {
    yield toLine(concat(pending, pendingLength), false);
  }
}
