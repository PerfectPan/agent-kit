import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { zstdCompressSync, zstdDecompressSync } from "node:zlib";

import { describe, expect, it } from "vite-plus/test";

import { readOriginal } from "@rivus/agent-kit-sessions/public";
import { createMemoryPlatform } from "@rivus/agent-kit-testing/public";
import { dshSessionAdapter } from "../src/sessions.js";

const plain = fileURLToPath(new URL("fixtures/sessions/conformance/plain/session.v4.jsonl", import.meta.url));

describe("dsh zstd logs", () => {
  it("loads concatenated frames and reads each record back through its pointer", async () => {
    const text = await readFile(plain, "utf8");
    const bytes = Buffer.concat(
      text
        .split("\n")
        .filter((line) => line.trim().length > 0)
        .map((line) => zstdCompressSync(`${line}\n`))
    );
    const memory = createMemoryPlatform({ files: { "/logs/session.v4.jsonl.zstd": bytes } });
    const platform = {
      fs: memory.fs,
      decompress: (format: "zstd", input: Uint8Array) => {
        expect(format).toBe("zstd");
        return zstdDecompressSync(input);
      }
    };
    const result = await dshSessionAdapter.load(platform, {
      agent: "dsh",
      path: "/logs/session.v4.jsonl.zstd"
    });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    const request = result.value.events.find((event) => event.kind === "request");
    expect(request?.source.codec).toBe("zstd");
    expect(request).toBeDefined();
    if (request !== undefined) {
      const original = await readOriginal(platform, request.source);
      expect(original.ok).toBe(true);
      if (original.ok) {
        expect(original.value).toEqual(request.original);
      }
    }
  });

  it("lists a compressed log from its first frames", async () => {
    const text = await readFile(plain, "utf8");
    const bytes = Buffer.concat(
      text
        .split("\n")
        .filter((line) => line.trim().length > 0)
        .map((line) => zstdCompressSync(`${line}\n`))
    );
    const memory = createMemoryPlatform({ files: { "/logs/session.v4.jsonl.zstd": bytes } });
    const platform = {
      fs: memory.fs,
      decompress: (_format: "zstd", input: Uint8Array) => zstdDecompressSync(input)
    };
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
});
