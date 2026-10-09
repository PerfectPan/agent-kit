import { chmod, mkdir, mkdtemp, readdir, readFile, realpath, rm, stat, symlink, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ByteRange } from "@rivus/agent-kit-platform";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import { nodeFs } from "./fs.js";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "agent-kit-fs-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function chunks(path: string, range?: ByteRange): Promise<Uint8Array[]> {
  const out: Uint8Array[] = [];
  for await (const chunk of nodeFs.read(path, range)) {
    out.push(chunk);
  }
  return out;
}

function concat(parts: readonly Uint8Array[]): Uint8Array {
  return Uint8Array.from(parts.flatMap((part) => [...part]));
}

const modeOf = async (path: string) => (await stat(path)).mode & 0o777;

describe("stat", () => {
  it("S25: reports files, directories and symlinks without following links by default", async () => {
    await writeFile(join(dir, "file"), "abc");
    await mkdir(join(dir, "sub"));
    await symlink(join(dir, "file"), join(dir, "link"));

    expect(await nodeFs.stat(join(dir, "file"))).toEqual({
      kind: "file",
      size: 3,
      mtimeMs: expect.any(Number)
    });
    expect((await nodeFs.stat(join(dir, "sub")))?.kind).toBe("dir");
    expect((await nodeFs.stat(join(dir, "link")))?.kind).toBe("symlink");
    expect(await nodeFs.stat(join(dir, "link"), { followSymlinks: true })).toMatchObject({
      kind: "file",
      size: 3
    });
  });

  it("resolves to undefined for a missing path, a path under a file and a dangling link it follows", async () => {
    await writeFile(join(dir, "file"), "");
    await symlink(join(dir, "missing"), join(dir, "dangling"));

    expect(await nodeFs.stat(join(dir, "missing"))).toBeUndefined();
    expect(await nodeFs.stat(join(dir, "file", "child"))).toBeUndefined();
    expect((await nodeFs.stat(join(dir, "dangling")))?.kind).toBe("symlink");
    expect(await nodeFs.stat(join(dir, "dangling"), { followSymlinks: true })).toBeUndefined();
  });
});

describe("realpath", () => {
  it("S25: resolves links and returns undefined when the target does not exist", async () => {
    await mkdir(join(dir, "target"));
    await symlink(join(dir, "target"), join(dir, "link"));

    expect(await nodeFs.realpath(join(dir, "link"))).toBe(await realpath(join(dir, "target")));
    expect(await nodeFs.realpath(join(dir, "link", "missing"))).toBeUndefined();
    expect(await nodeFs.realpath(join(dir, "missing"))).toBeUndefined();
  });
});

describe("list", () => {
  it("reports a symlink to a directory as a symlink", async () => {
    await writeFile(join(dir, "file"), "");
    await mkdir(join(dir, "sub"));
    await symlink(join(dir, "sub"), join(dir, "link"));

    const entries = await nodeFs.list(dir);
    expect(entries.toSorted((a, b) => a.name.localeCompare(b.name))).toEqual([
      { name: "file", kind: "file" },
      { name: "link", kind: "symlink" },
      { name: "sub", kind: "dir" }
    ]);
  });

  it("reports a socket as other in both list and stat", async () => {
    const server = createServer();
    await new Promise<void>((resolve) => server.listen(join(dir, "sock"), resolve));
    try {
      expect(await nodeFs.list(dir)).toEqual([{ name: "sock", kind: "other" }]);
      expect((await nodeFs.stat(join(dir, "sock")))?.kind).toBe("other");
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  it("rejects for a missing directory", async () => {
    await expect(nodeFs.list(join(dir, "missing"))).rejects.toMatchObject({ code: "ENOENT" });
  });
});

describe("read", () => {
  const size = 200_000;
  const bytes = Uint8Array.from({ length: size }, (_, at) => (at * 31) % 251);
  let path: string;

  beforeEach(async () => {
    path = join(dir, "data.bin");
    await writeFile(path, bytes);
  });

  it("reads the whole file", async () => {
    expect(concat(await chunks(path))).toEqual(bytes);
  });

  it("treats end as exclusive, including across a chunk boundary", async () => {
    expect(concat(await chunks(path, { start: 65_535, end: 65_537 }))).toEqual(bytes.subarray(65_535, 65_537));
    expect(concat(await chunks(path, { start: 10, end: 11 }))).toEqual(bytes.subarray(10, 11));
    expect(concat(await chunks(path, { start: 1000, end: 140_000 }))).toEqual(bytes.subarray(1000, 140_000));
    expect(await chunks(path, { start: 10, end: 10 })).toEqual([]);
  });

  it("returns a 64 KiB head or tail as one chunk and reads to the end without an end", async () => {
    expect((await chunks(path, { start: 0, end: 65_536 })).map((chunk) => chunk.byteLength)).toEqual([65_536]);
    const tail = await chunks(path, { start: size - 65_536 });
    expect(tail.map((chunk) => chunk.byteLength)).toEqual([65_536]);
    expect(concat(tail)).toEqual(bytes.subarray(size - 65_536));
    expect(await chunks(path, { start: size, end: size + 10 })).toEqual([]);
  });

  it("rejects on iteration when the file does not exist", async () => {
    await expect(chunks(join(dir, "missing"))).rejects.toMatchObject({ code: "ENOENT" });
  });
});

describe("writeAtomic", () => {
  it("creates a file with the requested mode, ignoring the umask", async () => {
    const path = join(dir, "new.json");
    await nodeFs.writeAtomic(path, "{}", { mode: 0o664 });

    expect(await readFile(path, "utf8")).toBe("{}");
    expect(await modeOf(path)).toBe(0o664);
  });

  it("keeps the existing file's mode when none is given", async () => {
    const path = join(dir, "existing");
    await writeFile(path, "old");
    await chmod(path, 0o600);

    await nodeFs.writeAtomic(path, new TextEncoder().encode("new"));
    expect(await readFile(path, "utf8")).toBe("new");
    expect(await modeOf(path)).toBe(0o600);
    expect(await readdir(dir)).toEqual(["existing"]);
  });

  it("replaces a symlink with a regular file", async () => {
    await writeFile(join(dir, "target"), "target");
    await symlink(join(dir, "target"), join(dir, "link"));

    await nodeFs.writeAtomic(join(dir, "link"), "replaced");
    expect((await nodeFs.stat(join(dir, "link")))?.kind).toBe("file");
    expect(await readFile(join(dir, "target"), "utf8")).toBe("target");
  });

  it("writes a target whose name is near the 255-byte file name limit", async () => {
    const name = "n".repeat(250);
    await nodeFs.writeAtomic(join(dir, name), "data");
    expect(await readdir(dir)).toEqual([name]);
  });

  it("removes the temp file when the final rename fails", async () => {
    await mkdir(join(dir, "occupied"));
    await writeFile(join(dir, "occupied", "keep"), "");

    await expect(nodeFs.writeAtomic(join(dir, "occupied"), "data")).rejects.toMatchObject({
      code: "EISDIR"
    });
    expect(await readdir(dir)).toEqual(["occupied"]);
  });
});

describe("createExclusive", () => {
  it("lets exactly one of two concurrent callers create the file", async () => {
    const path = join(dir, "lock");
    const results = await Promise.all([nodeFs.createExclusive(path), nodeFs.createExclusive(path)]);

    expect(results.toSorted()).toEqual([false, true]);
    expect(await nodeFs.createExclusive(path)).toBe(false);
    expect(await readFile(path, "utf8")).toBe("");
  });
});

describe("mkdir", () => {
  it("creates a directory with its parents, accepts one that exists and refuses a file in the way", async () => {
    await nodeFs.mkdir(join(dir, "a", "b"));
    await nodeFs.mkdir(join(dir, "a", "b"));
    expect((await nodeFs.stat(join(dir, "a", "b")))?.kind).toBe("dir");
    await writeFile(join(dir, "file"), "");
    await expect(nodeFs.mkdir(join(dir, "file"))).rejects.toMatchObject({ code: "EEXIST" });
    await expect(nodeFs.mkdir(join(dir, "file", "sub"))).rejects.toMatchObject({ code: "ENOTDIR" });
  });
});

describe("rename and remove", () => {
  it("renames over an existing file", async () => {
    await writeFile(join(dir, "a"), "a");
    await writeFile(join(dir, "b"), "b");

    await nodeFs.rename(join(dir, "a"), join(dir, "b"));
    expect(await readdir(dir)).toEqual(["b"]);
    expect(await readFile(join(dir, "b"), "utf8")).toBe("a");
  });

  it("removes a file, a symlink without its target and an empty directory, and ignores a missing path", async () => {
    await writeFile(join(dir, "file"), "");
    await symlink(join(dir, "file"), join(dir, "link"));
    await mkdir(join(dir, "empty"));

    await nodeFs.remove(join(dir, "link"));
    await nodeFs.remove(join(dir, "empty"));
    expect(await readdir(dir)).toEqual(["file"]);
    await nodeFs.remove(join(dir, "file"));
    await nodeFs.remove(join(dir, "file"));
    expect(await readdir(dir)).toEqual([]);
  });

  it("does not remove a non-empty directory", async () => {
    await mkdir(join(dir, "full"));
    await writeFile(join(dir, "full", "keep"), "");

    await expect(nodeFs.remove(join(dir, "full"))).rejects.toMatchObject({ code: "ENOTEMPTY" });
    expect(await readdir(join(dir, "full"))).toEqual(["keep"]);
  });
});
