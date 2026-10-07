import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "agent-kit-sqlite-"));
});

afterEach(async () => {
  vi.restoreAllMocks();
  vi.resetModules();
  await rm(dir, { recursive: true, force: true });
});

describe("nodeSqlite", () => {
  it("opens a database file for exec, prepared statements and read-only queries", async () => {
    const { nodeSqlite } = await import("./sqlite.js");
    const path = join(dir, "index.db");
    const db = nodeSqlite.open(path);
    db.exec("CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT, data BLOB)");
    const insert = db.prepare("INSERT INTO items (name, data) VALUES (?, ?)");
    expect(insert.run("a", Uint8Array.of(1, 2))).toEqual({ changes: 1, lastInsertRowid: 1 });
    insert.run("b", null);
    expect(db.prepare("SELECT name FROM items WHERE id = ?").get(2)).toEqual({ name: "b" });
    expect(db.prepare("SELECT name FROM items WHERE id = ?").get(9)).toBeUndefined();
    expect(db.prepare("SELECT id, data FROM items ORDER BY id").all()).toEqual([
      { id: 1, data: Uint8Array.of(1, 2) },
      { id: 2, data: null }
    ]);
    db.close();

    const readonly = nodeSqlite.open(path, { readonly: true });
    expect(readonly.prepare("SELECT count(*) AS n FROM items").get()).toEqual({ n: 2 });
    expect(() => readonly.exec("DELETE FROM items")).toThrow(/readonly/);
    readonly.close();
  });

  it("drops only the SQLite ExperimentalWarning while loading node:sqlite, and loads it once", async () => {
    const real = process.getBuiltinModule("node:sqlite");
    const emitted: unknown[][] = [];
    vi.spyOn(process, "emitWarning").mockImplementation((...args: unknown[]) => {
      emitted.push(args);
    });
    const load = vi.spyOn(process, "getBuiltinModule").mockImplementation(() => {
      process.emitWarning("SQLite is an experimental feature and might change at any time", "ExperimentalWarning");
      process.emitWarning("Other is an experimental feature", "ExperimentalWarning");
      process.emitWarning("SQLite but not experimental", { type: "DeprecationWarning" });
      return real;
    });
    const { nodeSqlite } = await import("./sqlite.js");

    nodeSqlite.open(":memory:").close();
    nodeSqlite.open(":memory:").close();
    expect(load).toHaveBeenCalledTimes(1);
    expect(emitted.map(([message]) => message)).toEqual([
      "Other is an experimental feature",
      "SQLite but not experimental"
    ]);
    process.emitWarning("SQLite is an experimental feature and might change at any time", "ExperimentalWarning");
    expect(emitted).toHaveLength(3);
  });
});
