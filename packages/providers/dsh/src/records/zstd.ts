import { EDGE_BYTES, readBytes, type SessionPlatform } from "@rivus/agent-kit-sessions/spi";

import { dshIsCompressed } from "../layout.js";

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

/** Whether `bytes` start at a frame: at least the magic number. A torn frame may still fail to complete. */
export function startsDshFrame(bytes: Uint8Array): boolean {
  return bytes.length >= 4 && u32(bytes, 0) === MAGIC;
}

/** The frame magic as bytes, little endian. */
const MAGIC_BYTES = [0x28, 0xb5, 0x2f, 0xfd];

/** Whether `bytes` are the first 1-3 bytes of a frame the writer just started appending: a torn magic prefix. */
export function isDshFramePrefix(bytes: Uint8Array): boolean {
  if (bytes.length === 0 || bytes.length >= 4) {
    return false;
  }
  for (let at = 0; at < bytes.length; at++) {
    if (bytes[at] !== MAGIC_BYTES[at]) {
      return false;
    }
  }
  return true;
}

/**
 * The text one complete frame decodes to, one frame per `decompress` call, so a caller that advances frame by frame
 * gets each frame's own decoded length; the frames are never combined. Undefined when the host cannot decode it.
 * The writer appends one frame per durable event batch and never splits a JSONL line across frames, so a frame's
 * text is whole lines.
 */
export function decodeDshFrame(platform: SessionPlatform, bytes: Uint8Array, frame: DshFrame): string | undefined {
  const decompress = platform.decompress;
  if (decompress === undefined) {
    return undefined;
  }
  try {
    return new TextDecoder().decode(decompress("zstd", bytes.subarray(frame.start, frame.end)));
  } catch {
    return undefined;
  }
}

/** The whole text the complete frames decode to, joined. Undefined when the host cannot decode them. */
function decodeFrames(platform: SessionPlatform, bytes: Uint8Array, frames: readonly DshFrame[]): string | undefined {
  const texts: string[] = [];
  for (const frame of frames) {
    const text = decodeDshFrame(platform, bytes, frame);
    if (text === undefined) {
      return undefined;
    }
    texts.push(text);
  }
  return texts.join("");
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
