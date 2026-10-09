import { asRecord } from "../../../domain/transcript/adapters/record-fields.js";
import { readBytes } from "./read-file.js";
import type { SessionPlatform } from "../../ports.js";

/** Listing reads at most this many bytes from each end of a session file. */
export const EDGE_BYTES: number = 64 * 1024;

export interface FileEdges {
  /** The decoded head, for cheap format checks. */
  head: string;
  headBytes: Uint8Array;
  tailBytes: Uint8Array;
  /** File offset of `tailBytes[0]`. */
  tailStart: number;
  size: number;
  mtimeMs: number;
  /** `headBytes` holds the entire file. */
  whole: boolean;
}

const NEWLINE = 0x0a;

/**
 * The first and last 64 KB of a file, `undefined` when `path` is not a file. A file between 64 KB and 128 KB is read
 * as two overlapping ranges.
 */
export async function readEdges(
  platform: SessionPlatform,
  path: string,
  options: { readonly signal?: AbortSignal } = {}
): Promise<FileEdges | undefined> {
  options.signal?.throwIfAborted();
  const info = await platform.fs.stat(path, { followSymlinks: true });
  if (info?.kind !== "file") {
    return undefined;
  }
  const whole = info.size <= EDGE_BYTES;
  const headBytes = await readBytes(platform, path, { start: 0, end: Math.min(info.size, EDGE_BYTES) }, options);
  const tailStart = whole ? info.size : info.size - EDGE_BYTES;
  options.signal?.throwIfAborted();
  const tailBytes = whole
    ? new Uint8Array(0)
    : await readBytes(platform, path, { start: tailStart, end: info.size }, options);
  const head = new TextDecoder().decode(headBytes);
  return { head, headBytes, tailBytes, tailStart, size: info.size, mtimeMs: info.mtimeMs, whole };
}

/**
 * Complete lines from both ends. The head keeps lines up to its last newline. When the ranges overlap, the tail
 * starts right after that newline, so no line is lost; otherwise the tail drops its first, partial line.
 */
export function edgeLines(edges: FileEdges): string[] {
  if (edges.whole) {
    return textLines(edges.headBytes);
  }
  const headCut = edges.headBytes.lastIndexOf(NEWLINE) + 1;
  let tailFrom: number;
  if (headCut > 0 && edges.tailStart <= headCut) {
    tailFrom = headCut - edges.tailStart;
  } else {
    const first = edges.tailBytes.indexOf(NEWLINE);
    tailFrom = first < 0 ? edges.tailBytes.length : first + 1;
  }
  return [...textLines(edges.headBytes.subarray(0, headCut)), ...textLines(edges.tailBytes.subarray(tailFrom))];
}

/** JSON object records from both ends; lines that are not JSON objects are left out. */
export function edgeRecords(edges: FileEdges): Record<string, unknown>[] {
  const records: Record<string, unknown>[] = [];
  for (const line of edgeLines(edges)) {
    try {
      const record = asRecord(JSON.parse(line) as unknown);
      if (record) {
        records.push(record);
      }
    } catch {
      // A line cut by the edge, or not JSON; the preview skips it.
    }
  }
  return records;
}

function textLines(bytes: Uint8Array): string[] {
  return new TextDecoder()
    .decode(bytes)
    .split("\n")
    .map((line) => (line.endsWith("\r") ? line.slice(0, -1) : line))
    .filter((line) => line.trim().length > 0);
}
