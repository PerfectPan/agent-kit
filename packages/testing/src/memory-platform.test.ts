import { splitLines } from "@rivus/agent-kit-platform";
import { describe, expect, it } from "vite-plus/test";

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

  it("creates directories with their parents and refuses a path that is a file", async () => {
    const platform = createMemoryPlatform({ files: { "/d/f": "" } });
    await platform.fs.mkdir("/a/b/c");
    await platform.fs.mkdir("/a/b/c");
    expect(await platform.fs.list("/a/b")).toEqual([{ name: "c", kind: "dir" }]);
    await expect(platform.fs.mkdir("/d/f")).rejects.toMatchObject({ code: "EEXIST" });
    await expect(platform.fs.mkdir("/d/f/g")).rejects.toMatchObject({ code: "ENOTDIR" });
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

  it("runs a seeded program with its arguments and the platform environment, like a spawn", async () => {
    const platform = createMemoryPlatform({
      env: { PATH: "/bin" },
      files: { "/u/me/notes.txt": "" },
      commands: {
        "/bin/echo": (args, options) => ({ stdout: `${args.join(" ")} ${options.env?.PATH}`, stderr: "warn" }),
        "/bin/fail": { code: 3 }
      }
    });
    expect(await platform.fs.stat("/bin/echo")).toMatchObject({ kind: "file" });
    expect(await platform.process.run("/bin/echo", ["a", "b"], { cwd: "/u/me", timeoutMs: 100 })).toEqual({
      code: 0,
      signal: null,
      stdout: "a b /bin",
      stderr: "warn",
      timedOut: false
    });
    expect(await platform.process.run("/bin/fail", [], { timeoutMs: 100 })).toMatchObject({ code: 3, stdout: "" });
    const run = (command: string, cwd?: string) =>
      platform.process.run(command, [], { timeoutMs: 100, ...(cwd === undefined ? {} : { cwd }) });
    await expect(run("/bin/missing")).rejects.toMatchObject({ code: "ENOENT" });
    await expect(run("/u/me/notes.txt")).rejects.toMatchObject({ code: "EACCES" });
    await expect(run("/bin/echo", "/nowhere")).rejects.toMatchObject({ code: "ENOENT" });
    await platform.fs.remove("/bin/echo");
    await expect(run("/bin/echo")).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("refuses a .cmd or .bat file on Windows with EINVAL, as Node does without a shell", async () => {
    const commands = { "C:\\npm\\tool.cmd": { stdout: "ran" }, "C:\\npm\\tool.BAT": { stdout: "ran" } };
    const windows = createMemoryPlatform({ os: "win32", commands });
    for (const command of Object.keys(commands)) {
      await expect(windows.process.run(command, [], { timeoutMs: 100 })).rejects.toMatchObject({ code: "EINVAL" });
    }
    const linux = createMemoryPlatform({ commands });
    expect(await linux.process.run("C:\\npm\\tool.cmd", [], { timeoutMs: 100 })).toMatchObject({ stdout: "ran" });
  });

  it("times a program out and rejects an aborted run with the signal's reason", async () => {
    const platform = createMemoryPlatform({ commands: { "/bin/hang": () => new Promise(() => undefined) } });
    expect(await platform.process.run("/bin/hang", [], { timeoutMs: 5 })).toEqual({
      code: null,
      signal: "SIGTERM",
      stdout: "",
      stderr: "",
      timedOut: true
    });
    const controller = new AbortController();
    const running = platform.process.run("/bin/hang", [], { timeoutMs: 10_000, signal: controller.signal });
    controller.abort(new Error("cancelled"));
    await expect(running).rejects.toThrow("cancelled");
    await expect(
      platform.process.run("/bin/hang", [], { timeoutMs: 10_000, signal: AbortSignal.abort(new Error("before")) })
    ).rejects.toThrow("before");
  });
});
