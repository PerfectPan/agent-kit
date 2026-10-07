import { type ByteRange, type Line, splitLines } from "@rivus/agent-kit-platform";
import type { SessionPlatform } from "../ports.js";

export interface ReadOptions {
  readonly signal?: AbortSignal;
  readonly progress?: ReadProgress;
}

/** A running byte count across the files of one load, reported to the caller's `onProgress`. */
export interface ReadProgress {
  add(bytes: number): void;
}

export function readProgress(onProgress?: (bytes: number) => void): ReadProgress {
  let total = 0;
  return {
    add(bytes) {
      total += bytes;
      onProgress?.(total);
    }
  };
}

export async function readBytes(
  platform: SessionPlatform,
  path: string,
  range?: ByteRange,
  options: ReadOptions = {}
): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let length = 0;
  for await (const chunk of abortable(platform.fs.read(path, range), options.signal)) {
    // Copy: a producer may reuse its chunk buffer after the next pull. Buffer#slice returns a view, not a copy.
    chunks.push(Uint8Array.prototype.slice.call(chunk));
    length += chunk.byteLength;
  }
  options.progress?.add(length);
  options.signal?.throwIfAborted();
  if (chunks.length === 1) {
    return chunks[0]!;
  }
  const out = new Uint8Array(length);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.byteLength;
  }
  return out;
}

/** The whole file as UTF-8 text, without a leading byte order mark. */
export async function readText(platform: SessionPlatform, path: string, options: ReadOptions = {}): Promise<string> {
  return new TextDecoder().decode(await readBytes(platform, path, undefined, options));
}

/** The file's lines with their byte offsets (see `splitLines`). Breaking out of the loop stops the read. */
export async function* readLines(
  platform: SessionPlatform,
  path: string,
  options: ReadOptions = {}
): AsyncGenerator<Line, void, undefined> {
  let read = 0;
  for await (const line of splitLines(abortable(platform.fs.read(path), options.signal))) {
    // One chunk can hold many lines, and a consumer such as `onProgress` may abort between them.
    options.signal?.throwIfAborted();
    const end = line.offset + line.byteLength + line.terminator.length;
    options.progress?.add(end - read);
    read = end;
    yield line;
  }
}

/**
 * Stops a read between chunks once `signal` aborts, rejecting with its reason, so a long line or a large range is
 * not read to the end after an abort. Closing early closes the platform's iterator.
 */
async function* abortable(
  chunks: AsyncIterable<Uint8Array>,
  signal: AbortSignal | undefined
): AsyncGenerator<Uint8Array> {
  signal?.throwIfAborted();
  for await (const chunk of chunks) {
    signal?.throwIfAborted();
    yield chunk;
  }
}
