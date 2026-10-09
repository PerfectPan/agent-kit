import { describe, expect, it } from "vite-plus/test";

import { scanSources, type ScanSourceEntry } from "./scan-sources.js";

interface Entry extends ScanSourceEntry {
  readonly cursor?: number;
}

const entry = (agent: string, path: string, mtimeMs: number, cursor?: number): Entry => ({
  agent: agent as Entry["agent"],
  path,
  mtimeMs,
  ...(cursor === undefined ? {} : { cursor })
});

describe("scan sources", () => {
  it("keeps a source's entry when its agent moves the file, and gives a copy its own key", () => {
    const sources = scanSources<Entry>({ "codex a": entry("codex", "/old/a.jsonl", 5, 1) });
    expect(sources.take({ agent: "codex", id: "a", path: "/new/a.jsonl" }, false)).toEqual({
      key: "codex a",
      known: entry("codex", "/old/a.jsonl", 5, 1)
    });
    sources.set("codex a", entry("codex", "/new/a.jsonl", 6, 3));
    const copy = sources.take({ agent: "codex", id: "a", path: "/here/a.jsonl" }, true);
    expect(copy.known).toBeUndefined();
    sources.set(copy.key, entry("codex", "/here/a.jsonl", 7, 2));
    expect(sources.all()).toEqual({
      "codex a": entry("codex", "/new/a.jsonl", 6, 3),
      "codex a /here/a.jsonl": entry("codex", "/here/a.jsonl", 7, 2)
    });
  });

  it("prunes what this scan did not find: gone, out of the window, or listed without failure", () => {
    const sources = scanSources<Entry>({
      "codex kept": entry("codex", "/r/kept.jsonl", 50),
      "codex old": entry("codex", "/r/old.jsonl", 5),
      "codex failed": entry("codex", "/r/failed/x.jsonl", 50),
      "codex other": entry("codex", "/r/other.jsonl", 50)
    });
    sources.take({ agent: "codex", id: "kept", path: "/r/kept.jsonl" }, false);
    sources.prune({ scanned: new Set(["codex"]), failed: ["/r/failed"], since: 10 });
    expect(sources.all()).toEqual({
      "codex kept": entry("codex", "/r/kept.jsonl", 50),
      "codex failed": entry("codex", "/r/failed/x.jsonl", 50)
    });
  });

  it("keeps the sources of an agent this scan did not cover", () => {
    const sources = scanSources<Entry>({ "pi a": entry("pi", "/r/a.jsonl", 5) });
    sources.prune({ scanned: new Set(["codex"]), failed: [], since: 10 });
    expect(sources.all()).toEqual({ "pi a": entry("pi", "/r/a.jsonl", 5) });
  });
});
