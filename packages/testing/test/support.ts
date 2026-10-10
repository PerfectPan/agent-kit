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
const USAGE_HOME_DIRS = {
  "claude-code": ".claude",
  codex: ".codex",
  "gemini-cli": ".gemini/tmp",
  grok: ".grok",
  opencode: ".local/share/opencode",
  pi: ".pi/agent"
} as const;

/** The usage fixtures at their paths in the agent homes under `home`, for `createMemoryPlatform({ files })`. */
export async function readUsageHome(home: string): Promise<Record<string, Uint8Array>> {
  const root = fileURLToPath(new URL("fixtures/usage", import.meta.url));
  const trees = await Promise.all(
    Object.entries(USAGE_HOME_DIRS).map(([agent, dir]) => readTree(join(root, agent), `${home}/${dir}`))
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

/** The Grok fixture sessions under `root` (the fixtures' `conformance` directory) and what each shows. */
export function grokSessions(root: string): ConformanceSession[] {
  const at = (path: string) => `${root}/${path}`;
  return [
    {
      path: at("plain/updates.jsonl"),
      records: 9,
      capabilities: ["requests", "usage", "durations", "reasoning", "hooks", "systemPrompt", "toolSchemas"]
    },
    { path: at("compaction/updates.jsonl"), records: 4, capabilities: ["compaction", "compactionTokens"] },
    { path: at("subagent/updates.jsonl"), records: 6, capabilities: ["subagents"] },
    { path: at("tool-title/updates.jsonl"), records: 5, capabilities: ["requests"] },
    { path: at("unknown-type/updates.jsonl"), records: 1, capabilities: [] },
    {
      path: at("tool-progress/updates.jsonl"),
      records: 10,
      capabilities: ["requests", "usage", "durations"]
    },
    { path: at("duplicate-turn/updates.jsonl"), records: 6, capabilities: ["requests", "usage", "durations"] },
    {
      path: at("subagent-meta-id/updates.jsonl"),
      records: 4,
      capabilities: ["requests", "usage", "durations", "subagents"]
    }
  ];
}

/** The Claude Code fixture sessions under `root` (the fixtures' `conformance` directory) and what each shows. */
export function claudeCodeSessions(root: string): ConformanceSession[] {
  const at = (path: string) => `${root}/${path}`;
  return [
    {
      path: at("plain/session.jsonl"),
      records: 7,
      capabilities: ["requests", "usage", "durations", "reasoning", "hooks"]
    },
    { path: at("compaction/session.jsonl"), records: 7, capabilities: ["compaction", "compactionTokens"] },
    {
      path: at("subagent/session.jsonl"),
      files: [at("subagent/session.jsonl"), at("subagent/session/subagents/agent-helper.jsonl")],
      records: 5,
      capabilities: ["subagents"]
    },
    { path: at("unknown-type/session.jsonl"), records: 6, capabilities: [] },
    {
      path: at("regroup/session.jsonl"),
      files: [at("regroup/session.jsonl"), at("regroup/session/subagents/workflows/wf-demo/agent-nested.jsonl")],
      records: 16,
      capabilities: ["requests", "usage", "subagents"]
    },
    {
      path: at("prompt-snapshot/session.jsonl"),
      files: [at("prompt-snapshot/session.jsonl"), at("prompt-snapshot/session/subagents/agent-worker.jsonl")],
      records: 13,
      capabilities: ["requests", "usage", "subagents", "systemPrompt", "toolSchemas"]
    },
    {
      path: at("empty-ids/session.jsonl"),
      files: [
        at("empty-ids/session.jsonl"),
        at("empty-ids/session/subagents/agent-.jsonl"),
        at("empty-ids/session/subagents/agent-mixed.jsonl")
      ],
      records: 9,
      capabilities: ["requests", "usage", "subagents"]
    },
    {
      path: at("summarize/session.jsonl"),
      files: [
        at("summarize/session.jsonl"),
        at("summarize/session/subagents/agent-helper.jsonl"),
        at("summarize/session/subagents/agent-fallback.jsonl")
      ],
      records: 11,
      capabilities: ["requests", "usage", "durations", "subagents"]
    }
  ];
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
