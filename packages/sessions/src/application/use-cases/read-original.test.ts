import { describe, expect, it } from "vite-plus/test";

import type { SqliteDatabase } from "@rivus/agent-kit-platform/public";

import { readOriginal } from "./read-original.js";
import type { SessionPlatform } from "../spi.js";

const encoder = new TextEncoder();

function fsOf(bytes: Uint8Array): SessionPlatform["fs"] {
  return {
    stat: async () => undefined,
    list: async () => [],
    async *read() {
      yield bytes;
    }
  };
}

describe("readOriginal", () => {
  it("decodes a compressed file before slicing its pointer", async () => {
    const record = encoder.encode('{"kind":"compressed"}');
    const platform: SessionPlatform = {
      fs: fsOf(encoder.encode("not the record")),
      decompress: (format, bytes) => {
        expect(format).toBe("zstd");
        expect(new TextDecoder().decode(bytes)).toBe("not the record");
        return encoder.encode(`xx${new TextDecoder().decode(record)}yy`);
      }
    };
    const result = await readOriginal(platform, {
      file: "/logs/session.jsonl.zstd",
      offset: 2,
      length: record.byteLength,
      line: 1,
      codec: "zstd"
    });
    expect(result).toEqual({ ok: true, value: { kind: "compressed" } });
  });

  it("reads one SQLite row through its pointer", async () => {
    const statements: string[] = [];
    const database: SqliteDatabase = {
      exec: () => undefined,
      close: () => undefined,
      prepare(sql) {
        statements.push(sql);
        return {
          run: () => ({ changes: 0, lastInsertRowid: 0 }),
          get: () => ({ value: '{"kind":"row"}' }),
          all: () => []
        };
      }
    };
    const platform: SessionPlatform = {
      fs: fsOf(new Uint8Array()),
      sqlite: {
        open: (path, options) => {
          expect(path).toBe("/data/opencode.db");
          expect(options).toEqual({ readonly: true });
          return database;
        }
      }
    };
    const result = await readOriginal(platform, {
      file: "/data/opencode.db",
      offset: 0,
      length: 0,
      line: 4,
      sqlite: { table: "part", column: "data", rowid: 7 }
    });
    expect(result).toEqual({ ok: true, value: { kind: "row" } });
    expect(statements).toEqual(["SELECT data AS value FROM part WHERE rowid = ?"]);
  });

  it("refuses a SQL identifier a pointer could have injected", async () => {
    const platform: SessionPlatform = { fs: fsOf(new Uint8Array()) };
    const result = await readOriginal(platform, {
      file: "/data/opencode.db",
      offset: 0,
      length: 0,
      line: 1,
      sqlite: { table: "part; drop table part", column: "data", rowid: 1 }
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error._tag).toBe("ReadFailed");
    }
  });

  it("reports a missing SQLite capability instead of guessing", async () => {
    const platform: SessionPlatform = { fs: fsOf(new Uint8Array()) };
    const result = await readOriginal(platform, {
      file: "/data/opencode.db",
      offset: 0,
      length: 0,
      line: 1,
      sqlite: { table: "part", column: "data", rowid: 1 }
    });
    expect(result.ok).toBe(false);
    if (!result.ok && result.error._tag === "ReadFailed") {
      expect(result.error.message).toContain("SQLite is not available");
    }
  });

  it("reports a missing decompressor instead of reading compressed bytes as text", async () => {
    const platform: SessionPlatform = { fs: fsOf(new Uint8Array()) };
    const result = await readOriginal(platform, {
      file: "/logs/session.jsonl.zstd",
      offset: 0,
      length: 1,
      line: 1,
      codec: "zstd"
    });
    expect(result.ok).toBe(false);
    if (!result.ok && result.error._tag === "ReadFailed") {
      expect(result.error.message).toContain("decompression is not available");
    }
  });
});
