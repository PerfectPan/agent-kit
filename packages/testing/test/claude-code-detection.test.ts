import { fileURLToPath } from "node:url";
import type { Result } from "@rivus/agent-kit-catalog";
import {
  listSessions,
  loadTranscript,
  summarizeSession,
  type SessionPlatform,
  type SessionHead,
  type SessionListFailure
} from "@rivus/agent-kit-sessions";
import { describe, expect, it } from "vite-plus/test";
import { createMemoryPlatform } from "../src/memory-platform.js";
import { readTree } from "./support.js";
import {
  builtinSessionAdapters,
  builtinSessionAdapters as testSessions,
  builtinCodingAgents as testIdentity
} from "./providers.js";
const tree = await readTree(
  fileURLToPath(new URL("../../providers/claude-code/test/fixtures/sessions", import.meta.url)),
  "/u/me/.claude/fx"
);
// Fixture sessions live under the default projects root, so listing finds them as real sessions.
const files = Object.fromEntries(
  Object.entries(tree).map(([path, bytes]) => [path.replace("/.claude/fx/conformance/", "/.claude/projects/"), bytes])
);
const platform = createMemoryPlatform({ files, home: "/u/me" });
const session = (name: string) => `/u/me/.claude/projects/${name}/session.jsonl`;

function value<T>(result: Result<T, unknown>): T {
  if (!result.ok) {
    throw new Error(`unexpected failure: ${JSON.stringify(result.error)}`);
  }
  return result.value;
}

function failing(error: Error): AsyncIterable<Uint8Array> {
  return {
    [Symbol.asyncIterator]: () => ({
      async next() {
        throw error;
      }
    })
  };
}
async function rejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("expected a rejection");
}

describe("session routing over Claude Code", () => {
  async function list(options: Omit<Parameters<typeof listSessions>[1], "providers"> = {}, on = platform) {
    const items: (SessionHead | SessionListFailure)[] = [];
    for await (const item of listSessions(on, {
      ...options,
      providers: { sessions: testSessions, identity: testIdentity }
    })) {
      items.push(item);
    }
    return items;
  }
  it("throws capability-unsupported for an agent without a session adapter", async () => {
    const error = await rejection(list({ agents: ["gemini-cli"] }));
    expect(error).toMatchObject({ code: "capability-unsupported" });
  });
  it("detects the agent of a ref without one, and returns tagged failures for the expected cases", async () => {
    expect(
      value(
        await loadTranscript(
          platform,
          { path: session("plain") },
          { providers: { sessions: testSessions, identity: testIdentity } }
        )
      ).agent
    ).toBe("claude-code");
    const foreign = createMemoryPlatform({ files: { "/x/notes.jsonl": '{"kind":"note"}\n' } });
    expect(
      await loadTranscript(
        foreign,
        { path: "/x/notes.jsonl" },
        { providers: { sessions: testSessions, identity: testIdentity } }
      )
    ).toEqual({
      ok: false,
      error: { _tag: "NoAdapterAccepted", path: "/x/notes.jsonl" }
    });
    expect(
      await loadTranscript(
        platform,
        { path: "/nowhere.jsonl" },
        { providers: { sessions: testSessions, identity: testIdentity } }
      )
    ).toEqual({
      ok: false,
      error: { _tag: "SessionNotFound", path: "/nowhere.jsonl" }
    });
    expect(
      await loadTranscript(
        platform,
        { agent: "gemini-cli", path: session("plain") },
        { providers: { sessions: testSessions, identity: testIdentity } }
      )
    ).toEqual({
      ok: false,
      error: { _tag: "CapabilityUnsupported", agent: "gemini-cli" }
    });
    expect(
      await summarizeSession(
        platform,
        { path: "/nowhere.jsonl" },
        { providers: { sessions: testSessions, identity: testIdentity } }
      )
    ).toEqual({
      ok: false,
      error: { _tag: "SessionNotFound", path: "/nowhere.jsonl" }
    });
  });

  it("returns an IO error during automatic detection as ReadFailed", async () => {
    const denied = Object.assign(new Error("EACCES: permission denied"), { code: "EACCES" });
    const custom = {
      ...builtinSessionAdapters["claude-code"],
      agent: "my-agent",
      async detect(on: SessionPlatform, ref: { path: string }) {
        for await (const _chunk of on.fs.read(ref.path)) {
          return true;
        }
        return false;
      }
    };
    const locked = { fs: { ...platform.fs, read: () => failing(denied) } };
    for (const run of [loadTranscript, summarizeSession]) {
      expect(
        await run(
          locked,
          { path: session("plain") },
          { providers: { sessions: { "my-agent": custom }, identity: testIdentity } }
        )
      ).toEqual({
        ok: false,
        error: { _tag: "ReadFailed", path: session("plain"), message: denied.message, cause: denied }
      });
    }
  });

  it("rejects with the abort reason instead of returning a failure found while resolving the target", async () => {
    const aborted = AbortSignal.abort(new Error("stop"));
    for (const run of [loadTranscript, summarizeSession]) {
      await expect(
        run(
          platform,
          { path: "/nowhere.jsonl" },
          { signal: aborted, providers: { sessions: testSessions, identity: testIdentity } }
        )
      ).rejects.toThrow("stop");
    }
    const controller = new AbortController();
    const declining = {
      ...builtinSessionAdapters["claude-code"],
      agent: "my-agent",
      async detect() {
        controller.abort(new Error("stop"));
        return false;
      }
    };
    const run = loadTranscript(
      platform,
      { path: session("plain") },
      { signal: controller.signal, providers: { sessions: { "my-agent": declining }, identity: testIdentity } }
    );
    await expect(run).rejects.toThrow("stop");
  });

  it("reports progress up to the total bytes of the session files and honours an abort", async () => {
    const progress: number[] = [];
    value(
      await loadTranscript(
        platform,
        { path: session("subagent") },
        { onProgress: (bytes) => progress.push(bytes), providers: { sessions: testSessions, identity: testIdentity } }
      )
    );
    const sizes = await Promise.all(
      [session("subagent"), "/u/me/.claude/projects/subagent/session/subagents/agent-helper.jsonl"].map(
        async (path) => (await platform.fs.stat(path))?.size ?? 0
      )
    );
    const metaSize = (
      await platform.fs.stat("/u/me/.claude/projects/subagent/session/subagents/agent-helper.meta.json")
    )?.size;
    expect(progress.at(-1)).toBe(sizes[0]! + sizes[1]! + metaSize!);
    expect(progress).toEqual(progress.toSorted((a, b) => a - b));
    const aborted = AbortSignal.abort();
    expect(
      await rejection(
        loadTranscript(
          platform,
          { path: session("plain") },
          { signal: aborted, providers: { sessions: testSessions, identity: testIdentity } }
        )
      )
    ).toMatchObject({
      name: "AbortError"
    });
  });

  it("returns ReadFailed when automatic detection cannot read an exported session", async () => {
    const denied = Object.assign(new Error("EACCES: permission denied"), { code: "EACCES" });
    const exported = createMemoryPlatform({ files: { "/export/session.jsonl": "{}\n" } });
    const locked = { fs: { ...exported.fs, read: () => failing(denied) } };
    const options = {
      providers: { sessions: { "claude-code": builtinSessionAdapters["claude-code"] }, identity: testIdentity }
    };
    for (const run of [loadTranscript, summarizeSession]) {
      expect(await run(locked, { path: "/export/session.jsonl" }, options)).toEqual({
        ok: false,
        error: { _tag: "ReadFailed", path: "/export/session.jsonl", message: denied.message, cause: denied }
      });
    }
  });
});
