import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import zlib from "node:zlib";

import { describe, expect, it, vi } from "vite-plus/test";

import { readOriginal, type SessionPlatform } from "@rivus/agent-kit-sessions/public";
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

  it.skipIf(typeof zlib.zstdCompressSync !== "function")(
    "lists and detects a compressed session whose first frame spans past the 64 KB head cap",
    async () => {
      // Incompressible filler keeps the single zstd frame larger than the 64 KB head slice even after compression.
      let state = 0x9e3779b9;
      const random = (): number => {
        state = (state * 1664525 + 1013904223) >>> 0;
        return state;
      };
      const alphabet = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
      const filler = Array.from({ length: 200 * 1024 }, () => alphabet[random() % alphabet.length]!).join("");
      const text =
        '{"type":"session","version":4,"id":"big-frame","createdAt":1,"cwd":"/u/me/work"}\n' +
        `{"type":"user/message","seq":1,"time":2,"data":{"role":"user","content":[{"type":"text","text":"${filler}"}],"source":{"kind":"user"}}}\n`;
      const frame = zlib.zstdCompressSync(text);
      expect(frame.length).toBeGreaterThan(64 * 1024);
      const path = "/logs/session.v4.jsonl.zstd";
      const memory = createMemoryPlatform({ files: { [path]: { content: frame, mtimeMs: 1_234_567_890 } } });
      const platform = { ...createNodePlatform(), fs: memory.fs };
      const ref = { agent: "dsh", path };
      const heads = [];
      for await (const item of dshSessionAdapter.discover(platform, "/logs")) {
        heads.push(item);
      }
      // The head holds no complete frame, so discovery lists the session from its mtime instead of failing it.
      expect(heads).toHaveLength(1);
      expect(heads[0]).toStrictEqual({
        ref: { agent: "dsh", path },
        lastActiveAt: 1_234_567_890,
        sizeBytes: frame.length
      });
      // Detection recognizes the same file from its name and frame magic.
      expect(await dshSessionAdapter.detect(platform, ref)).toBe(true);
      // A whole-file load still decodes the complete frame.
      const loaded = await dshSessionAdapter.load(platform, ref);
      expect(loaded.ok).toBe(true);
      if (loaded.ok) {
        expect(loaded.value.events).toHaveLength(1);
      }
    }
  );

  it("caps the decoded head prefix and lists the session from its mtime instead", async () => {
    // A minimal zstd frame whose RLE block decodes to Block_Maximum_Size (128 KB): magic, a window descriptor for
    // windowLog 23, and a last RLE block of one repeated byte. A 64 KB head of these expands to hundreds of MB; the
    // cap must stop the decode and degrade the head.
    const rleFrame = Buffer.from([0x28, 0xb5, 0x2f, 0xfd, 0x00, 0x68, 0x03, 0x00, 0x00, 0x41]);
    const bytes = Buffer.concat(Array.from({ length: 7000 }, () => rleFrame));
    expect(bytes.length).toBeGreaterThan(64 * 1024);
    const decompress = vi.fn<NonNullable<SessionPlatform["decompress"]>>(() => new Uint8Array(128 * 1024).fill(0x41));
    const path = "/logs/session.v4.jsonl.zstd";
    const memory = createMemoryPlatform({ files: { [path]: { content: bytes, mtimeMs: 987_654_321 } } });
    const platform: SessionPlatform = { fs: memory.fs, decompress };
    const heads = [];
    for await (const item of dshSessionAdapter.discover(platform, "/logs")) {
      heads.push(item);
    }
    expect(heads).toHaveLength(1);
    expect(heads[0]).toStrictEqual({
      ref: { agent: "dsh", path },
      lastActiveAt: 987_654_321,
      sizeBytes: bytes.length
    });
    // The first frame already exceeds the decoded-byte budget, so no further frame is decoded.
    expect(decompress).toHaveBeenCalledTimes(1);
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
