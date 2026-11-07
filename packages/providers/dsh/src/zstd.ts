import { EDGE_BYTES, readBytes, type SessionPlatform } from "@rivus/agent-kit-sessions/spi";

import { dshIsCompressed } from "./layout.js";

/** The Zstandard frame magic, little endian. */
const MAGIC = 0xfd2fb528;

export interface DshFrame {
  /** Inclusive start of the frame in the file. */
  start: number;
  /** Exclusive end of the frame. */
  end: number;
}

export interface DshText {
  text: string;
  codec?: "zstd";
}

function u32(bytes: Uint8Array, at: number): number {
  return (bytes[at]! | (bytes[at + 1]! << 8) | (bytes[at + 2]! << 16) | (bytes[at + 3]! << 24)) >>> 0;
}

/** The end of the frame starting at `start`, or undefined when the bytes end inside it. */
function frameEnd(bytes: Uint8Array, start: number): number | undefined {
  let at = start + 4;
  if (at >= bytes.length) {
    return undefined;
  }
  const descriptor = bytes[at++]!;
  if ((descriptor & 0x08) !== 0) {
    return undefined;
  }
  const contentSizeFlag = descriptor >> 6;
  const singleSegment = (descriptor >> 5) & 1;
  const checksum = (descriptor >> 2) & 1;
  const dictionaryFlag = descriptor & 3;
  if (singleSegment === 0) {
    at += 1;
  }
  at += dictionaryFlag === 3 ? 4 : dictionaryFlag;
  if (contentSizeFlag === 0) {
    if (singleSegment === 1) {
      at += 1;
    }
  } else if (contentSizeFlag === 1) {
    at += 2;
  } else if (contentSizeFlag === 2) {
    at += 4;
  } else {
    at += 8;
  }
  if (at > bytes.length) {
    return undefined;
  }
  for (;;) {
    if (at + 3 > bytes.length) {
      return undefined;
    }
    const header = bytes[at]! | (bytes[at + 1]! << 8) | (bytes[at + 2]! << 16);
    at += 3;
    const last = header & 1;
    const type = (header >> 1) & 3;
    const size = header >>> 3;
    if (type === 3) {
      return undefined;
    }
    at += type === 1 ? 1 : size;
    if (at > bytes.length) {
      return undefined;
    }
    if (last === 1) {
      break;
    }
  }
  if (checksum === 1) {
    at += 4;
  }
  return at <= bytes.length ? at : undefined;
}

/**
 * Complete frames at the start of `bytes`, in order. An incomplete final frame is omitted, so a head slice decodes
 * every frame it fully holds; bytes that are not a frame at all give undefined.
 */
export function scanDshFrames(bytes: Uint8Array): DshFrame[] | undefined {
  const frames: DshFrame[] = [];
  let at = 0;
  while (at < bytes.length) {
    if (at + 4 > bytes.length || u32(bytes, at) !== MAGIC) {
      return frames.length === 0 ? undefined : frames;
    }
    const end = frameEnd(bytes, at);
    if (end === undefined) {
      return frames;
    }
    frames.push({ start: at, end });
    at = end;
  }
  return frames;
}

function decodeFrames(platform: SessionPlatform, bytes: Uint8Array, frames: readonly DshFrame[]): string | undefined {
  const decompress = platform.decompress;
  if (decompress === undefined) {
    return undefined;
  }
  const decoder = new TextDecoder();
  let text = "";
  try {
    for (const frame of frames) {
      text += decoder.decode(decompress("zstd", bytes.subarray(frame.start, frame.end)), { stream: true });
    }
  } catch {
    return undefined;
  }
  return text + decoder.decode();
}

/** The whole file's text, with `codec` set when it was compressed. Undefined when the host cannot decode it. */
export async function readDshText(
  platform: SessionPlatform,
  path: string,
  options: { readonly signal?: AbortSignal } = {}
): Promise<DshText | undefined> {
  const bytes = await readBytes(platform, path, { start: 0 }, options);
  if (!dshIsCompressed(path)) {
    return { text: new TextDecoder().decode(bytes) };
  }
  const frames = scanDshFrames(bytes);
  if (frames === undefined || frames.length === 0) {
    return undefined;
  }
  const text = decodeFrames(platform, bytes, frames);
  return text === undefined ? undefined : { text, codec: "zstd" };
}

/**
 * As much text as the frames in the file's first 64 KB decode to. Discovery reads only this; a caller that needs
 * every record calls `readDshText`.
 */
export async function readDshHead(
  platform: SessionPlatform,
  path: string,
  size: number,
  options: { readonly signal?: AbortSignal } = {}
): Promise<string | undefined> {
  if (!dshIsCompressed(path)) {
    const bytes = await readBytes(platform, path, { start: 0, end: Math.min(size, EDGE_BYTES) }, options);
    return new TextDecoder().decode(bytes);
  }
  const head = await readBytes(platform, path, { start: 0, end: Math.min(size, EDGE_BYTES) }, options);
  const frames = scanDshFrames(head);
  if (frames === undefined || frames.length === 0) {
    return undefined;
  }
  return decodeFrames(platform, head, frames);
}
