import zlib from "node:zlib";

import { describe, expect, it, vi } from "vite-plus/test";

import { createNodeDecompress, decompressFrames, nodeDecompress } from "./zstd.js";

const hasZstd = typeof zlib.zstdDecompressSync === "function";

describe("Node zstd capability", () => {
  it("is absent when this runtime has no zstd", () => {
    const decompress = nodeDecompress;
    expect(typeof decompress).toBe(hasZstd ? "function" : "undefined");
  });

  it.skipIf(!hasZstd)("decodes all concatenated frames, including output larger than a zlib chunk", () => {
    const parts = ["first\n", "middle\n".repeat(10_000), "last\n"];
    const bytes = Buffer.concat(parts.map((part) => zlib.zstdCompressSync(part)));
    const decompress = nodeDecompress;
    const decoded = Buffer.from(decompress!("zstd", bytes)).toString();
    expect(decoded.length).toBe(parts.join("").length);
    expect(decoded).toBe(parts.join(""));
  });

  it.skipIf(!hasZstd)("continues past empty frames", () => {
    const parts = ["", "first", "", "last", ""];
    const bytes = Buffer.concat(parts.map((part) => zlib.zstdCompressSync(part)));
    const decompress = nodeDecompress;
    expect(Buffer.from(decompress!("zstd", bytes)).toString()).toBe("firstlast");
  });

  it.skipIf(!hasZstd)("ignores a non-frame suffix after complete frames", () => {
    const frames = ["first", "last"].map((part) => zlib.zstdCompressSync(part));
    for (const tail of [Buffer.alloc(1), Buffer.alloc(4), Buffer.from("garbage"), Buffer.from([0x28, 0xb5, 0x2f])]) {
      expect(Buffer.from(nodeDecompress!("zstd", Buffer.concat([...frames, tail]))).toString()).toBe("firstlast");
    }
  });

  it.skipIf(!hasZstd)("rejects garbage before the first frame", () => {
    const bytes = Buffer.concat([Buffer.alloc(1), zlib.zstdCompressSync("first")]);
    expect(() => nodeDecompress!("zstd", bytes)).toThrow("Unknown frame descriptor");
  });

  it.skipIf(!hasZstd)("preserves complete output before an incomplete final frame", () => {
    const first = zlib.zstdCompressSync("first\n");
    const last = zlib.zstdCompressSync("unfinished record\n");
    const bytes = Buffer.concat([first, last.subarray(0, Math.floor(last.length / 2))]);
    expect(Buffer.from(nodeDecompress!("zstd", bytes)).toString().startsWith("first\n")).toBe(true);
  });

  it.skipIf(!hasZstd)("continues through skippable frames", () => {
    const first = zlib.zstdCompressSync("first");
    const last = zlib.zstdCompressSync("last");
    for (let kind = 0x50; kind <= 0x5f; kind += 1) {
      const skip = Buffer.from([kind, 0x2a, 0x4d, 0x18, 1, 0, 0, 0, 42]);
      const bytes = Buffer.concat([skip, first, skip, last, skip]);
      expect(Buffer.from(nodeDecompress!("zstd", bytes)).toString()).toBe("firstlast");
    }
  });

  it.skipIf(!hasZstd)("rejects a checksum mismatch in a recognized later frame", () => {
    const first = zlib.zstdCompressSync("first");
    const last = zlib.zstdCompressSync("last", {
      params: { [zlib.constants.ZSTD_c_checksumFlag]: 1 }
    });
    last[last.length - 1] = last[last.length - 1]! ^ 0xff;
    expect(() => nodeDecompress!("zstd", Buffer.concat([first, last]))).toThrow("Restored data doesn't match checksum");
  });
});

describe("Node zstd compatibility without runtime assumptions", () => {
  it("omits decompression when the injected module has no codec", () => {
    expect(createNodeDecompress({})).toBeUndefined();
  });

  it("repeats an injected decoder that consumes only the first frame", () => {
    const bytes = Buffer.from([0x28, 0xb5, 0x2f, 0xfd, 1, 0x28, 0xb5, 0x2f, 0xfd, 2, 0x28, 0xb5, 0x2f, 0xfd, 3]);
    const decodeOnce = vi.fn<Parameters<typeof decompressFrames>[1]>((input) => ({
      buffer: input.subarray(4, 5),
      bytesWritten: 5
    }));
    expect(decompressFrames(bytes, decodeOnce)).toEqual(Buffer.from([1, 2, 3]));
    expect(decodeOnce).toHaveBeenCalledTimes(3);
  });

  it("continues through skippable frames with an injected single-frame decoder", () => {
    const first = Buffer.from([0x28, 0xb5, 0x2f, 0xfd, 1]);
    const last = Buffer.from([0x28, 0xb5, 0x2f, 0xfd, 2]);
    for (let kind = 0x50; kind <= 0x5f; kind += 1) {
      const skip = Buffer.from([kind, 0x2a, 0x4d, 0x18, 0, 0, 0, 0]);
      const bytes = Buffer.concat([first, skip, last]);
      const decodeOnce = vi
        .fn<Parameters<typeof decompressFrames>[1]>()
        .mockReturnValueOnce({ buffer: Buffer.from([1]), bytesWritten: first.length })
        .mockReturnValueOnce({ buffer: Buffer.alloc(0), bytesWritten: skip.length })
        .mockReturnValueOnce({ buffer: Buffer.from([2]), bytesWritten: last.length });
      expect(decompressFrames(bytes, decodeOnce)).toEqual(Buffer.from([1, 2]));
      expect(decodeOnce).toHaveBeenCalledTimes(3);
      expect(decodeOnce).toHaveBeenNthCalledWith(2, bytes.subarray(first.length));
    }
  });

  it("returns empty output for empty input without calling the decoder", () => {
    const decodeOnce = vi.fn<Parameters<typeof decompressFrames>[1]>();
    expect(decompressFrames(new Uint8Array(), decodeOnce)).toEqual(Buffer.alloc(0));
    expect(decodeOnce).not.toHaveBeenCalled();
    if (hasZstd) {
      expect(nodeDecompress!("zstd", new Uint8Array())).toEqual(Buffer.alloc(0));
    }
  });

  it.each([0, 6])("rejects an injected decoder's invalid consumption of %i bytes", (bytesWritten) => {
    const bytes = Buffer.from([0x28, 0xb5, 0x2f, 0xfd, 1]);
    expect(() => decompressFrames(bytes, () => ({ buffer: new Uint8Array(), bytesWritten }))).toThrow(
      "Zstandard decompression did not consume a valid input range"
    );
  });
});
