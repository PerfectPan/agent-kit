import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import zlib from "node:zlib";

import { describe, expect, it, vi } from "vite-plus/test";

import { readOriginal } from "@rivus/agent-kit-sessions/public";
import { createMemoryPlatform } from "@rivus/agent-kit-testing/public";
import { createNodePlatform } from "@rivus/agent-kit-platform-node/public";
import { dshSessionAdapter } from "../src/sessions.js";

const plain = fileURLToPath(new URL("fixtures/sessions/conformance/plain/session.v4.jsonl", import.meta.url));

describe("dsh zstd logs on the Node platform", () => {
  it
    .skipIf(typeof zlib.zstdCompressSync !== "function")
    .each(["intact", "half frame", "missing checksum", "one NUL", "four NULs"] as const)(
    "loads and reads every original with %s suffix",
    async (suffix) => {
      const text = await readFile(plain, "utf8");
      const complete = Buffer.concat(
        text
          .split("\n")
          .filter((line) => line.trim().length > 0)
          .map((line) => zlib.zstdCompressSync(`${line}\n`))
      );
      const final = zlib.zstdCompressSync('{"type":"x","seq":99,"time":1}\n', {
        params: { [zlib.constants.ZSTD_c_checksumFlag]: 1 }
      });
      const tails = {
        intact: Buffer.alloc(0),
        "half frame": final.subarray(0, Math.floor(final.length / 2)),
        "missing checksum": final.subarray(0, final.length - 4),
        "one NUL": Buffer.alloc(1),
        "four NULs": Buffer.alloc(4)
      };
      const bytes = Buffer.concat([complete, tails[suffix]]);
      const memory = createMemoryPlatform({ files: { "/logs/session.v4.jsonl.zstd": bytes } });
      const platform = { ...createNodePlatform(), fs: memory.fs };
      const result = await dshSessionAdapter.load(platform, {
        agent: "dsh",
        path: "/logs/session.v4.jsonl.zstd"
      });
      expect(result.ok).toBe(true);
      if (!result.ok) {
        return;
      }
      expect(result.value.events).toHaveLength(11);
      expect(result.value.events.some((event) => event.source.line > 1)).toBe(true);
      for (const event of result.value.events) {
        expect(event.source.codec).toBe("zstd");
        expect(await readOriginal(platform, event.source)).toEqual({
          ok: true,
          value: event.original
        });
      }
    }
  );

  it.skipIf(typeof zlib.zstdCompressSync !== "function")("lists a compressed log from its first frames", async () => {
    const text = await readFile(plain, "utf8");
    const bytes = Buffer.concat(
      text
        .split("\n")
        .filter((line) => line.trim().length > 0)
        .map((line) => zlib.zstdCompressSync(`${line}\n`))
    );
    const memory = createMemoryPlatform({ files: { "/logs/session.v4.jsonl.zstd": bytes } });
    const platform = { ...createNodePlatform(), fs: memory.fs };
    const heads = [];
    for await (const item of dshSessionAdapter.discover(platform, "/logs")) {
      heads.push(item);
    }
    expect(heads).toHaveLength(1);
    const head = heads[0];
    expect(head).toBeDefined();
    if (head !== undefined && !("error" in head)) {
      expect(head.ref.sessionId).toBe("dsh-plain");
      expect(head.title).toBe("Plain session");
    }
  });
  it("reports ReadFailed for a valid compressed frame without a decoder", async () => {
    const path = "/logs/session.v4.jsonl.zstd";
    // A complete Zstandard raw block containing a session header, usable even on Node without a compressor.
    const header = Buffer.from('{"type":"session","version":4,"id":"missing-codec","createdAt":1}\n');
    const block = (header.length << 3) | 1;
    const frame = Buffer.concat([
      Buffer.from([0x28, 0xb5, 0x2f, 0xfd, 0x20, header.length, block & 0xff, (block >> 8) & 0xff, 0]),
      header
    ]);
    const memory = createMemoryPlatform({ files: { [path]: frame } });
    const decoded = new TextDecoder().decode(header);
    const decompress = vi.fn<NonNullable<ReturnType<typeof createNodePlatform>["decompress"]>>(() => header);
    const loaded = await dshSessionAdapter.load({ fs: memory.fs, decompress }, { agent: "dsh", path });
    expect(loaded.ok).toBe(true);
    expect(decompress).toHaveBeenCalledWith("zstd", new Uint8Array(frame));
    if (typeof zlib.zstdDecompressSync === "function") {
      expect(zlib.zstdDecompressSync(frame).toString()).toBe(decoded);
    }
    expect(await dshSessionAdapter.load(memory, { agent: "dsh", path })).toMatchObject({
      ok: false,
      error: { _tag: "ReadFailed" }
    });
  });
});
