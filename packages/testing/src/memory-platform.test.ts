import { splitLines } from "@rivus/agent-kit-platform";
import { describe, expect, it } from "vitest";

import { createMemoryPlatform } from "./memory-platform.js";

async function collect(chunks: AsyncIterable<Uint8Array>): Promise<number[][]> {
  const out: number[][] = [];
  for await (const chunk of chunks) {
    out.push([...chunk]);
  }
  return out;
}

describe("createMemoryPlatform", () => {
  it("stats seeded files and their implied directories, and lists a directory sorted by name", async () => {
    const platform = createMemoryPlatform({
      files: { "/a/b/z.txt": "z", "/a//b/./c/../y.txt": { content: "yy", mtimeMs: 5 } },
      now: () => 9
    });
    expect(await platform.fs.stat("/a/b/y.txt")).toEqual({ kind: "file", size: 2, mtimeMs: 5 });
    expect(await platform.fs.stat("/a/b/z.txt")).toEqual({ kind: "file", size: 1, mtimeMs: 9 });
    expect(await platform.fs.stat("/a/b/")).toEqual({ kind: "dir", size: 0, mtimeMs: 9 });
    expect(await platform.fs.stat("/a/missing")).toBeUndefined();
    expect(await platform.fs.realpath("/a/x/../b")).toBe("/a/b");
    expect(await platform.fs.realpath("/a/x")).toBeUndefined();
    expect(await platform.fs.list("/a")).toEqual([{ name: "b", kind: "dir" }]);
    expect(await platform.fs.list("/a/b")).toEqual([
      { name: "y.txt", kind: "file" },
      { name: "z.txt", kind: "file" }
    ]);
    await expect(platform.fs.list("/nope")).rejects.toMatchObject({ code: "ENOENT" });
    await expect(platform.fs.list("/a/b/y.txt")).rejects.toMatchObject({ code: "ENOTDIR" });
  });

  it("reads a byte range with an exclusive end in chunks of the configured size", async () => {
    const platform = createMemoryPlatform({ files: { "/f": "abcdefg" }, chunkSize: 3 });
    const bytes = (text: string) => [...new TextEncoder().encode(text)];
    expect(await collect(platform.fs.read("/f"))).toEqual([bytes("abc"), bytes("def"), bytes("g")]);
    expect(await collect(platform.fs.read("/f", { start: 2, end: 6 }))).toEqual([bytes("cde"), bytes("f")]);
    expect(await collect(platform.fs.read("/f", { start: 5, end: 100 }))).toEqual([bytes("fg")]);
    expect(await collect(platform.fs.read("/f", { start: 4, end: 4 }))).toEqual([]);
    await expect(collect(platform.fs.read("/missing"))).rejects.toMatchObject({ code: "ENOENT" });
    await expect(collect(platform.fs.read("/"))).rejects.toMatchObject({ code: "EISDIR" });
  });

  it("keeps line offsets exact when chunks split a multi-byte character", async () => {
    const platform = createMemoryPlatform({ files: { "/f": "é😀\nß\n" }, chunkSize: 1 });
    const lines = [];
    for await (const line of splitLines(platform.fs.read("/f"))) {
      lines.push([line.text, line.offset, line.byteLength]);
    }
    expect(lines).toEqual([
      ["é😀", 0, 6],
      ["ß", 7, 2]
    ]);
  });

  it("writes, creates exclusively, renames and removes", async () => {
    const platform = createMemoryPlatform({ now: () => 1 });
    await platform.fs.writeAtomic("/d/e/f.json", "{}");
    expect(await platform.fs.stat("/d/e")).toMatchObject({ kind: "dir" });
    expect(await platform.fs.createExclusive("/d/e/f.json")).toBe(false);
    expect(await platform.fs.createExclusive("/d/lock")).toBe(true);
    expect(await platform.fs.stat("/d/lock")).toMatchObject({ kind: "file", size: 0 });
    await platform.fs.rename("/d/e", "/d/g");
    expect(await platform.fs.stat("/d/g/f.json")).toMatchObject({ kind: "file", size: 2 });
    expect(await platform.fs.stat("/d/e/f.json")).toBeUndefined();
    await platform.fs.rename("/d/g/f.json", "/d/g/f.json");
    expect(await platform.fs.stat("/d/g/f.json")).toMatchObject({ kind: "file" });
    await expect(platform.fs.remove("/d/g")).rejects.toMatchObject({ code: "ENOTEMPTY" });
    await platform.fs.remove("/d/g/f.json");
    await platform.fs.remove("/d/g");
    expect(await platform.fs.list("/d")).toEqual([{ name: "lock", kind: "file" }]);
    await expect(platform.fs.remove("/d/g")).resolves.toBeUndefined();
  });

  it("renames like POSIX: replaces a file or an empty directory, and refuses the rest", async () => {
    const platform = createMemoryPlatform({
      files: { "/a/x.txt": "x", "/a/y.txt": "y", "/src/in.txt": "in", "/full/kept.txt": "kept", "/empty/.keep": "" }
    });
    await platform.fs.remove("/empty/.keep");
    await expect(platform.fs.rename("/src", "/full")).rejects.toMatchObject({ code: "ENOTEMPTY" });
    await expect(platform.fs.rename("/src", "/a/x.txt")).rejects.toMatchObject({ code: "ENOTDIR" });
    await expect(platform.fs.rename("/a/x.txt", "/full")).rejects.toMatchObject({ code: "EISDIR" });
    await expect(platform.fs.rename("/src", "/src/deeper")).rejects.toMatchObject({ code: "EINVAL" });
    await expect(platform.fs.rename("/a/x.txt", "/nowhere/x.txt")).rejects.toMatchObject({ code: "ENOENT" });
    await expect(platform.fs.rename("/missing", "/a/z.txt")).rejects.toMatchObject({ code: "ENOENT" });
    expect(await platform.fs.list("/full")).toEqual([{ name: "kept.txt", kind: "file" }]);
    expect(await platform.fs.stat("/a/x.txt")).toMatchObject({ kind: "file" });

    await platform.fs.rename("/a/x.txt", "/a/y.txt");
    expect(await platform.fs.list("/a")).toEqual([{ name: "y.txt", kind: "file" }]);
    expect(await platform.fs.stat("/a/y.txt")).toMatchObject({ size: 1 });
    await platform.fs.rename("/src", "/empty");
    expect(await platform.fs.list("/empty")).toEqual([{ name: "in.txt", kind: "file" }]);
    expect(await platform.fs.stat("/src")).toBeUndefined();
  });

  it("copies bytes in and out, so a caller's Buffer cannot change a stored file", async () => {
    const { Buffer } = globalThis as unknown as { Buffer: { from(text: string): Uint8Array } };
    const seeded = Buffer.from("seed");
    const written = Buffer.from("data");
    const platform = createMemoryPlatform({ files: { "/seeded": seeded } });
    await platform.fs.writeAtomic("/written", written);
    seeded.fill(0x21);
    written.fill(0x21);
    for await (const chunk of platform.fs.read("/seeded")) {
      chunk.fill(0x21);
    }
    const text = async (path: string) => {
      let out = "";
      for await (const chunk of platform.fs.read(path)) {
        out += new TextDecoder().decode(chunk);
      }
      return out;
    };
    expect([await text("/seeded"), await text("/written")]).toEqual(["seed", "data"]);
  });

  it("freezes a copy of the environment and defaults home, os and the clock", () => {
    const env = { A: "1" };
    const platform = createMemoryPlatform({ env, now: () => 42 });
    env.A = "2";
    expect(platform.env).toEqual({ A: "1" });
    expect(Object.isFrozen(platform.env)).toBe(true);
    expect([platform.home, platform.os, platform.clock.now()]).toEqual(["/u/me", "linux", 42]);
  });
});
