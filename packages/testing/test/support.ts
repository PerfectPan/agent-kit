import { createReadStream } from "node:fs";
import { lstat, readdir, readFile, realpath, stat } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

import type { FileKind, PlatformFs, PlatformSqlite } from "@rivus/agent-kit-platform";

import type { ConformanceSession } from "../src/session-adapter-conformance.js";

/** Every file under `dir`, keyed by `<prefix>/<relative path>`, for `createMemoryPlatform({ files })`. */
export async function readTree(dir: string, prefix: string): Promise<Record<string, Uint8Array>> {
  const files: Record<string, Uint8Array> = {};
  for (const entry of await readdir(dir, { recursive: true, withFileTypes: true })) {
    if (entry.isFile()) {
      const path = join(entry.parentPath, entry.name);
      files[`${prefix}/${relative(dir, path).split(sep).join("/")}`] = await readFile(path);
    }
  }
  return files;
}

/**
 * Where each agent's directory under `fixtures/usage` sits in a home. The fixtures cannot keep the home layout: the
 * repository check rejects tracked paths with a `.codex` or `tmp` segment, and Codex and Gemini CLI homes have them.
 */
const USAGE_FIXTURES = {
  "claude-code": { home: ".claude", source: "../../providers/claude-code/test/fixtures/usage" },
  codex: { home: ".codex", source: "fixtures/usage/codex" },
  "gemini-cli": { home: ".gemini/tmp", source: "../../providers/gemini-cli/test/fixtures/usage" },
  grok: { home: ".grok", source: "../../providers/grok/test/fixtures/usage" },
  opencode: { home: ".local/share/opencode", source: "../../providers/opencode/test/fixtures/usage" },
  pi: { home: ".pi/agent", source: "../../providers/pi/test/fixtures/usage" }
} as const;

/** The usage fixtures at their paths in the agent homes under `home`, for `createMemoryPlatform({ files })`. */
export async function readUsageHome(home: string): Promise<Record<string, Uint8Array>> {
  const trees = await Promise.all(
    Object.values(USAGE_FIXTURES).map((fixture) =>
      readTree(fileURLToPath(new URL(fixture.source, import.meta.url)), `${home}/${fixture.home}`)
    )
  );
  return Object.assign({}, ...trees) as Record<string, Uint8Array>;
}

const kindOf = (entry: { isFile(): boolean; isDirectory(): boolean; isSymbolicLink(): boolean }): FileKind =>
  entry.isFile() ? "file" : entry.isDirectory() ? "dir" : entry.isSymbolicLink() ? "symlink" : "other";

const missing = (error: unknown): boolean => ["ENOENT", "ENOTDIR"].includes((error as { code?: string }).code ?? "");

/**
 * The read side of a Node file system, enough for session adapters. A stand-in for `createNodePlatform` from the
 * platform-node package, which is developed in parallel; switch to it once both are on the same branch.
 */
export function nodeReadFs(): Pick<PlatformFs, "stat" | "realpath" | "list" | "read"> {
  return {
    async stat(path, options) {
      try {
        const info = options?.followSymlinks ? await stat(path) : await lstat(path);
        return { kind: kindOf(info), size: info.size, mtimeMs: info.mtimeMs };
      } catch (error) {
        if (missing(error)) {
          return undefined;
        }
        throw error;
      }
    },
    async realpath(path) {
      try {
        return await realpath(path);
      } catch (error) {
        if (missing(error)) {
          return undefined;
        }
        throw error;
      }
    },
    async list(dir) {
      return (await readdir(dir, { withFileTypes: true })).map((entry) => ({
        name: entry.name,
        kind: kindOf(entry)
      }));
    },
    async *read(path, range) {
      const end = range?.end;
      if (end !== undefined && end <= (range?.start ?? 0)) {
        return;
      }
      yield* createReadStream(path, { start: range?.start ?? 0, ...(end === undefined ? {} : { end: end - 1 }) });
    }
  };
}

/** SQLite on `node:sqlite`, a stand-in for the Node platform's, which the testing package does not depend on. */
export function nodeSqlite(): PlatformSqlite {
  const sqlite = process.getBuiltinModule("node:sqlite");
  return {
    open: (path, options) => new sqlite.DatabaseSync(path, { readOnly: options?.readonly ?? false })
  };
}

/** The Codex fixture sessions under `root` (the fixtures' `conformance` directory) and what each shows. */
export function codexSessions(root: string): ConformanceSession[] {
  const at = (name: string) => `${root}/rollout-${name}.jsonl`;
  return [
    { path: at("plain"), records: 14, capabilities: ["requests", "usage", "durations", "reasoning", "systemPrompt"] },
    { path: at("token-count"), records: 14, capabilities: ["requests", "usage"] },
    { path: at("compaction"), records: 11, capabilities: ["compaction", "subagents"] },
    { path: at("subagent"), records: 9, capabilities: ["subagents"] },
    { path: at("unknown"), records: 7, capabilities: [] },
    { path: at("fork"), records: 20, capabilities: ["requests", "usage", "durations", "reasoning", "systemPrompt"] },
    { path: at("fork-one-call"), records: 19, capabilities: ["requests", "usage", "durations"] },
    { path: at("legacy"), records: 9, capabilities: ["reasoning"] },
    { path: at("interrupted"), records: 12, capabilities: ["requests", "usage", "durations"] },
    { path: at("duplicate-usage"), records: 5, capabilities: ["requests", "usage"] },
    { path: at("token-delta"), records: 6, capabilities: ["requests", "usage"] }
  ];
}
