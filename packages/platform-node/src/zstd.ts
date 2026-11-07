import zlib from "node:zlib";

import type { Decompress } from "@rivus/agent-kit-platform/public";

type DecodedChunk = { buffer: Uint8Array; bytesWritten: number };

function startsFrame(bytes: Uint8Array): boolean {
  if (bytes.length < 4) {
    return false;
  }
  const magic = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0, true);
  return magic === 0xfd2fb528 || (magic & 0xfffffff0) === 0x184d2a50;
}

// These helpers stay outside public.ts; injection exercises older Node behavior on any test runtime.
export function decompressFrames(bytes: Uint8Array, decodeOnce: (input: Uint8Array) => DecodedChunk): Uint8Array {
  const chunks: Uint8Array[] = [];
  let offset = 0;
  while (offset < bytes.length) {
    const remaining = bytes.subarray(offset);
    // A non-frame suffix can be left by an interrupted writer. A recognized frame still goes through zlib's
    // validation, including its checksum; invalid input before any frame must also fail there.
    if (offset > 0 && !startsFrame(remaining)) {
      break;
    }
    const { buffer, bytesWritten } = decodeOnce(remaining);
    if (bytesWritten <= 0 || bytesWritten > remaining.length) {
      throw new Error("Zstandard decompression did not consume a valid input range");
    }
    chunks.push(buffer);
    offset += bytesWritten;
  }
  return Buffer.concat(chunks);
}

export function createNodeDecompress(
  module: Partial<Pick<typeof zlib, "zstdDecompressSync" | "constants">>
): Decompress | undefined {
  const decode = module.zstdDecompressSync;
  if (typeof decode !== "function") {
    return undefined;
  }
  return (_format, bytes) =>
    decompressFrames(bytes, (remaining) => {
      // Flush preserves available output from a torn final frame, so earlier record pointers remain readable.
      // Some Node versions stop after one frame; info reports the consumed input. Node's types omit this overload.
      const { buffer, engine } = decode(remaining, {
        info: true,
        finishFlush: module.constants?.ZSTD_e_flush
      }) as unknown as { buffer: Uint8Array; engine: { bytesWritten: number } };
      return { buffer, bytesWritten: engine.bytesWritten };
    });
}

// The default import also works on Node releases with no Zstandard exports.
export const nodeDecompress: Decompress | undefined = createNodeDecompress(zlib);
