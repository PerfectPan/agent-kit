import { fileURLToPath } from "node:url";

import type { Result } from "@rivus/agent-kit-catalog";
import {
  builtinSessionAdapters,
  foldTranscript,
  isSessionHead,
  listSessions,
  loadTranscript,
  promptSnapshot,
  readOriginal,
  type SessionHead,
  type SessionListFailure,
  type SessionPlatform,
  summarizeSession,
  translateClaudeCodeRecords,
  type Transcript
} from "@rivus/agent-kit-sessions";
import { describe, expect, it } from "vite-plus/test";

import { createMemoryPlatform } from "../src/memory-platform.js";
import { readTree } from "./support.js";

const tree = await readTree(fileURLToPath(new URL("fixtures/claude-code", import.meta.url)), "/u/me/.claude/fx");
// Fixture sessions live under the default projects root, so listing finds them as real sessions.
const files = Object.fromEntries(
  Object.entries(tree).map(([path, bytes]) => [path.replace("/.claude/fx/conformance/", "/.claude/projects/"), bytes])
);
const platform = createMemoryPlatform({ files, home: "/u/me" });
const session = (name: string) => `/u/me/.claude/projects/${name}/session.jsonl`;
const load = async (name: string): Promise<Transcript> =>
  value(await loadTranscript(platform, { agent: "claude-code", path: session(name) }));

function value<T>(result: Result<T, unknown>): T {
  if (!result.ok) {
    throw new Error(`unexpected failure: ${JSON.stringify(result.error)}`);
  }
  return result.value;
}

// oxlint-disable-next-line require-yield -- an iterator that fails on its first pull, like an unreadable file
async function* failing(error: Error): AsyncGenerator<Uint8Array> {
  throw error;
}

async function rejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("expected a rejection");
}

describe("claude-code translation", () => {
  it("groups requests, maps usage in the community convention and keeps turn duration off the request", async () => {
    const transcript = await load("plain");
    const requests = transcript.events.filter((event) => event.kind === "request");
    expect(requests[0]?.payload).toMatchObject({
      model: "claude-test",
      responseId: "msg-1",
      finishReason: "tool_use",
      usage: {
        inputTokens: 13,
        outputTokens: 4,
        totalTokens: 17,
        cacheReadTokens: 1,
        cacheWriteTokens: 2
      }
    });
    // The one-hour breakdown is the cache write count, and thinking tokens are the reasoning count.
    expect(requests[1]?.payload.usage).toEqual({
      inputTokens: 27,
      outputTokens: 5,
      totalTokens: 32,
      cacheWriteTokens: 7,
      cacheWrite1hTokens: 4,
      reasoningTokens: 2
    });
    expect(requests[1]?.payload.durationMs).toBeUndefined();
    const duration = transcript.events.find(
      (event) => event.kind === "system" && event.payload.type === "turn_duration"
    );
    expect(duration?.payload.durationMs).toBe(1500);
    expect(foldTranscript(transcript).contextShape).toEqual([13, 27]);
    expect(transcript.events.find((event) => event.kind === "tool_result")?.payload.isError).toBe(true);
    expect(transcript.events.some((event) => event.kind === "hook" && event.payload.name === "Stop")).toBe(true);
    expect(transcript.events.find((event) => event.kind === "reasoning")?.payload).toEqual({
      text: "Look at the test command."
    });
    expect(transcript).toMatchObject({
      agent: "claude-code",
      agentVersion: "2.0.0",
      session: { id: "s-plain" }
    });
  });

  it("merges request ids A, B, A, accounts for nested journals and resolves a parent that became no event", async () => {
    const transcript = await load("regroup");
    const requests = transcript.events.filter((event) => event.kind === "request");
    expect(requests.map((event) => event.requestId)).toEqual(["req-a", "req-b", "req-c"]);
    expect(requests[0]?.payload.usage).toEqual({
      inputTokens: 13,
      outputTokens: 4,
      totalTokens: 17,
      cacheReadTokens: 1,
      cacheWriteTokens: 2
    });
    expect(transcript.session.title).toBe("Grouped");
    expect(transcript.events.find((event) => event.agentId === "sidechain")?.kind).toBe("user");
    expect(transcript.agents).toContainEqual({ id: "sidechain", parentId: "main" });
    expect(transcript.agents).toContainEqual({
      id: "nested",
      parentId: "main",
      spawnEventId: "g-a1:1",
      title: "Nested work"
    });
    const seq = (id: string) => transcript.events.find((event) => event.id === id)?.seq ?? -1;
    expect(seq("n-u")).toBeLessThan(seq("g-b"));
    const undated = transcript.events.find((event) => event.id === "g-nots");
    expect(undated?.ts).toBe(Date.parse("2026-01-01T00:00:06.000Z"));
    expect(transcript.events.every((event) => event.ts > 0)).toBe(true);
    expect(transcript.skipped.map((skip) => skip.reason).toSorted()).toEqual([
      "agent-meta",
      "attachment:todo_reminder",
      "custom-title",
      "journal",
      "pr-link",
      "relocated"
    ]);
    const journal = transcript.skipped.find((skip) => skip.reason === "journal");
    expect(journal?.source).toMatchObject({ offset: 0, line: 1, length: 83 });
    expect(transcript.events.find((event) => event.id === "g-after")?.parentId).toBe("g-u");
    expect(transcript.events.find((event) => event.id === "g-img")).toMatchObject({
      kind: "user",
      payload: { image: true, mediaType: "image/png" }
    });
    expect(transcript.events.find((event) => event.id === "g-cmd")?.payload.command).toBe(true);
    expect(transcript.events.find((event) => event.id === "g-int")?.payload.injected).toBe(true);
    expect(foldTranscript(transcript).turns).toBe(2);
  });

  it("shadows events outside the preserved segment and keeps the summary after its boundary", async () => {
    const transcript = await load("compaction");
    expect(transcript.events.find((event) => event.kind === "compaction")?.payload).toEqual({
      trigger: "auto",
      preTokens: 1000,
      postTokens: 100
    });
    const shadowed = new Set(transcript.events.filter((event) => event.shadowedBy).map((event) => event.id));
    expect([...shadowed].toSorted()).toEqual(["c-a1", "c-u1", "request:req-c1"]);
    const ids = transcript.events.map((event) => event.id);
    expect(ids.indexOf("c-sum")).toBeGreaterThan(ids.indexOf("c-b1"));
    expect(transcript.events.find((event) => event.id === "c-sum")?.parentId).toBe("c-b1");
  });

  it("keeps a subagent on the parent session", async () => {
    const transcript = await load("subagent");
    expect(transcript.agents).toContainEqual({
      id: "helper",
      parentId: "main",
      spawnEventId: "m-a1:1",
      title: "Look around"
    });
    expect(transcript.events.filter((event) => event.agentId === "helper").map((event) => event.kind)).toEqual([
      "user",
      "request",
      "assistant"
    ]);
  });

  it("keeps an unknown record type, skips a line that is not JSON and names model fallbacks", async () => {
    const transcript = await load("unknown-type");
    expect(transcript.events.filter((event) => event.kind === "unknown").map((event) => event.payload.type)).toEqual([
      "widget"
    ]);
    expect(transcript.skipped).toEqual([{ reason: "invalid-json", source: expect.objectContaining({ line: 3 }) }]);
    expect(transcript.events.find((event) => event.id === "k-f1")?.payload).toEqual({
      type: "model_refusal_fallback",
      text: "Retried on another model.",
      originalModel: "claude-a",
      fallbackModel: "claude-b",
      apiRefusalCategory: "policy"
    });
    expect(transcript.events.find((event) => event.id === "k-a1")?.payload).toEqual({
      type: "fallback",
      fromModel: "claude-a",
      toModel: "claude-b"
    });
    expect(transcript.session.title).toBe("Hello");
    expect(foldTranscript(transcript).turns).toBe(1);
  });

  it("returns an unknown format generation as a tagged failure", async () => {
    const path = "/u/me/.claude/fx/unknown-generation/session.jsonl";
    expect(await loadTranscript(platform, { agent: "claude-code", path })).toEqual({
      ok: false,
      error: { _tag: "UnknownFormatGeneration", agent: "claude-code", file: path, line: 1 }
    });
  });

  it("returns an unknown generation of a prompt snapshot as a value from the pure translation", () => {
    const value = {
      type: "attachment",
      uuid: "x",
      timestamp: "2026-01-01T00:00:00.000Z",
      version: "2.1.268",
      attachment: { type: "prompt_snapshot", systemPrompt: [{ text: "x" }] }
    };
    expect(
      translateClaudeCodeRecords([{ record: { value, file: "f.jsonl", line: 1, offset: 0, length: 1 }, ts: 1 }])
    ).toEqual({
      ok: false,
      error: { _tag: "UnknownFormatGeneration", agent: "claude-code", file: "f.jsonl", line: 1 }
    });
  });
});

describe("claude-code subagent metadata", () => {
  it("points a metadata file with a byte order mark at its JSON text", async () => {
    const meta = '{"description":"Look around"}';
    const bom = Uint8Array.of(0xef, 0xbb, 0xbf, ...new TextEncoder().encode(meta));
    const root = "/u/me/.claude/projects/p";
    const withBom = createMemoryPlatform({
      files: {
        [`${root}/s.jsonl`]: '{"type":"user","uuid":"m","sessionId":"s","message":{"content":"Go"}}\n',
        [`${root}/s/subagents/agent-a.jsonl`]:
          '{"type":"user","uuid":"a","agentId":"a","isSidechain":true,"message":{"content":"x"}}\n',
        [`${root}/s/subagents/agent-a.meta.json`]: bom
      }
    });
    const transcript = value(await loadTranscript(withBom, { agent: "claude-code", path: `${root}/s.jsonl` }));
    const skip = transcript.skipped.find((entry) => entry.reason === "agent-meta");
    expect(skip?.source).toEqual({
      file: `${root}/s/subagents/agent-a.meta.json`,
      offset: 3,
      length: meta.length,
      line: 1
    });
    expect(await readOriginal(withBom, skip!.source)).toEqual({
      ok: true,
      value: { description: "Look around" }
    });
    expect(transcript.agents.find((lane) => lane.id === "a")?.title).toBe("Look around");
  });
});

describe("claude-code prompt snapshots", () => {
  it("keeps each snapshot as a system event with its source and original", async () => {
    const transcript = await load("prompt-snapshot");
    const snapshots = transcript.events.filter((event) => promptSnapshot(event) !== undefined);
    expect(snapshots.map((event) => [event.id, event.agentId])).toEqual([
      ["p-s1", undefined],
      ["p-s2", undefined],
      ["w-s1", "worker"],
      ["p-s3", undefined]
    ]);
    expect(snapshots[0]?.payload).toEqual({
      type: "prompt_snapshot",
      systemPrompt: "You are a test agent.\n\nPrompt version one."
    });
    expect(snapshots[1]?.payload).toMatchObject({
      cliPrefix: "Test CLI prefix.",
      tools: [{ name: "Read" }]
    });
    expect(snapshots[3]?.payload.tools).toHaveLength(2);
    for (const event of snapshots) {
      expect(await readOriginal(platform, event.source)).toEqual({
        ok: true,
        value: event.original
      });
    }
    expect(transcript.skipped.some((skip) => skip.reason === "attachment:prompt_snapshot")).toBe(false);
  });

  it("sets the session and lane fields from the latest snapshot and lists the capabilities", async () => {
    const transcript = await load("prompt-snapshot");
    expect(transcript.session.systemPrompt).toBe("You are a test agent.\n\nPrompt version two.");
    expect(transcript.session.tools).toHaveLength(2);
    expect(transcript.agents.find((agent) => agent.id === "worker")).toEqual({
      id: "worker",
      parentId: "main",
      spawnEventId: "p-a2:1",
      title: "Check a file",
      systemPrompt: "You are a test worker."
    });
    expect(transcript.capabilities).toEqual(expect.arrayContaining(["systemPrompt", "toolSchemas"]));
    const plain = await load("plain");
    expect(plain.capabilities).not.toContain("systemPrompt");
    expect(plain.session.systemPrompt).toBeUndefined();
  });
});

describe("sessions use cases over Claude Code", () => {
  async function list(options: Parameters<typeof listSessions>[1] = {}, on = platform) {
    const items: (SessionHead | SessionListFailure)[] = [];
    for await (const item of listSessions(on, options)) {
      items.push(item);
    }
    return items;
  }

  it("lists the sessions under the agent home and titles each with its first real prompt", async () => {
    const totals: number[] = [];
    const items = await list({ agents: ["claude"], onTotal: (files) => totals.push(files) });
    const heads = items.filter(isSessionHead);
    expect(heads).toHaveLength(items.length);
    expect(heads.map((head) => head.ref.path).toSorted()).toEqual(
      ["compaction", "plain", "prompt-snapshot", "regroup", "subagent", "unknown-type"].map(session)
    );
    expect(totals).toEqual([6]);
    expect(heads.find((head) => head.ref.path === session("unknown-type"))).toMatchObject({
      ref: { agent: "claude-code", sessionId: "s-unknown" },
      title: "Hello",
      firstPrompt: "Hello",
      cwd: "/work/app"
    });
  });

  it("reads the home from CLAUDE_CONFIG_DIR and reports a missing root as a failure item", async () => {
    const moved = createMemoryPlatform({
      files: {
        "/cfg/claude/projects/p/a.jsonl": '{"type":"user","sessionId":"a","message":{"content":"Hi"}}\n'
      },
      env: { CLAUDE_CONFIG_DIR: "/cfg/claude" }
    });
    expect(await list({ agents: ["claude-code"] }, moved)).toMatchObject([
      { ref: { path: "/cfg/claude/projects/p/a.jsonl" }, title: "Hi" }
    ]);
    expect(await list({ agents: ["claude-code"] }, createMemoryPlatform())).toEqual([
      {
        ref: { agent: "claude-code", path: "/u/me/.claude/projects" },
        error: { _tag: "RootMissing", path: "/u/me/.claude/projects" }
      }
    ]);
  });

  it("throws capability-unsupported for an agent without a session adapter", async () => {
    const error = await rejection(list({ agents: ["gemini-cli"] }));
    expect(error).toMatchObject({ code: "capability-unsupported" });
  });

  it("detects the agent of a ref without one, and returns tagged failures for the expected cases", async () => {
    expect(value(await loadTranscript(platform, { path: session("plain") })).agent).toBe("claude-code");
    const foreign = createMemoryPlatform({ files: { "/x/notes.jsonl": '{"kind":"note"}\n' } });
    expect(await loadTranscript(foreign, { path: "/x/notes.jsonl" })).toEqual({
      ok: false,
      error: { _tag: "NoAdapterAccepted", path: "/x/notes.jsonl" }
    });
    expect(await loadTranscript(platform, { path: "/nowhere.jsonl" })).toEqual({
      ok: false,
      error: { _tag: "SessionNotFound", path: "/nowhere.jsonl" }
    });
    expect(await loadTranscript(platform, { agent: "gemini-cli", path: session("plain") })).toEqual({
      ok: false,
      error: { _tag: "CapabilityUnsupported", agent: "gemini-cli" }
    });
    expect(await summarizeSession(platform, { path: "/nowhere.jsonl" })).toEqual({
      ok: false,
      error: { _tag: "SessionNotFound", path: "/nowhere.jsonl" }
    });
  });

  it("returns an IO error as ReadFailed and a changed source as SourceChanged", async () => {
    const denied = Object.assign(new Error("EACCES: permission denied"), { code: "EACCES" });
    const locked = {
      fs: {
        ...platform.fs,
        read(path: string, range?: { start: number; end?: number }) {
          return path.endsWith("agent-helper.jsonl") ? failing(denied) : platform.fs.read(path, range);
        }
      }
    };
    expect(await loadTranscript(locked, { agent: "claude-code", path: session("subagent") })).toEqual({
      ok: false,
      error: {
        _tag: "ReadFailed",
        path: session("subagent"),
        message: denied.message,
        cause: denied
      }
    });
    const source = { file: session("plain"), offset: 1, length: 10, line: 1 };
    expect(await readOriginal(platform, source)).toEqual({
      ok: false,
      error: { _tag: "SourceChanged", source }
    });
    expect(await readOriginal(platform, { ...source, file: "/gone.jsonl" })).toEqual({
      ok: false,
      error: { _tag: "SessionNotFound", path: "/gone.jsonl" }
    });
  });

  it("rejects a load cancelled between lines of one chunk instead of resolving", async () => {
    const records = ["a", "b", "c"].map(
      (uuid) => `{"type":"user","uuid":"${uuid}","sessionId":"s","message":{"content":"x"}}`
    );
    const one = createMemoryPlatform({ files: { "/p/s.jsonl": `${records.join("\n")}\n` } });
    const controller = new AbortController();
    const progress: number[] = [];
    const load = loadTranscript(
      one,
      { agent: "claude-code", path: "/p/s.jsonl" },
      {
        signal: controller.signal,
        onProgress: (bytes) => {
          progress.push(bytes);
          controller.abort(new Error("stop"));
        }
      }
    );
    await expect(load).rejects.toThrow("stop");
    expect(progress).toHaveLength(1);
  });

  it("returns only file system errno failures as values; a callback's or a defect's code still rejects", async () => {
    const uiError = { code: "E_UI_STATE" };
    const callback = loadTranscript(
      platform,
      { agent: "claude-code", path: session("plain") },
      {
        onProgress: () => {
          throw uiError;
        }
      }
    );
    await expect(callback).rejects.toBe(uiError);
    const fakeErrno = Object.assign(new Error("EACCES from a callback"), { code: "EACCES" });
    const lying = loadTranscript(
      platform,
      { agent: "claude-code", path: session("plain") },
      {
        onProgress: () => {
          throw fakeErrno;
        }
      }
    );
    await expect(lying).rejects.toBe(fakeErrno);
    const range = Object.assign(new RangeError("offset out of range"), {
      code: "ERR_OUT_OF_RANGE"
    });
    const strict = { fs: { ...platform.fs, read: () => failing(range) } };
    await expect(readOriginal(strict, { file: session("plain"), offset: -1, length: 1, line: 1 })).rejects.toBe(range);
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
      expect(await run(locked, { path: session("plain") }, { adapters: { "my-agent": custom } })).toEqual({
        ok: false,
        error: {
          _tag: "ReadFailed",
          path: session("plain"),
          message: denied.message,
          cause: denied
        }
      });
    }
  });

  it("rejects with the abort reason instead of returning a failure found while resolving the target", async () => {
    const aborted = AbortSignal.abort(new Error("stop"));
    for (const run of [loadTranscript, summarizeSession]) {
      await expect(run(platform, { path: "/nowhere.jsonl" }, { signal: aborted })).rejects.toThrow("stop");
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
      {
        adapters: { "my-agent": declining },
        signal: controller.signal
      }
    );
    await expect(run).rejects.toThrow("stop");
  });

  it("still throws a defect instead of returning it", async () => {
    const broken = { fs: { ...platform.fs, read: () => failing(new TypeError("bug")) } };
    await expect(loadTranscript(broken, { agent: "claude-code", path: session("plain") })).rejects.toThrow("bug");
  });

  it("reports progress up to the total bytes of the session files and honours an abort", async () => {
    const progress: number[] = [];
    value(
      await loadTranscript(platform, { path: session("subagent") }, { onProgress: (bytes) => progress.push(bytes) })
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
    expect(await rejection(loadTranscript(platform, { path: session("plain") }, { signal: aborted }))).toMatchObject({
      name: "AbortError"
    });
  });

  it("summarizes a session like folding its transcript", async () => {
    const summary = value(await summarizeSession(platform, { agent: "claude-code", path: session("plain") }));
    expect(summary).toEqual({
      turns: 1,
      requests: 2,
      inputTokens: 40,
      outputTokens: 9,
      durationMs: 1500,
      compactions: 0,
      subagents: 0,
      failedTools: 1,
      contextShape: [13, 27]
    });
  });

  it("returns ReadFailed when automatic detection cannot read an exported session", async () => {
    const denied = Object.assign(new Error("EACCES: permission denied"), { code: "EACCES" });
    const exported = createMemoryPlatform({ files: { "/export/session.jsonl": "{}\n" } });
    const locked = { fs: { ...exported.fs, read: () => failing(denied) } };
    const options = { adapters: { "claude-code": builtinSessionAdapters["claude-code"] } };
    for (const run of [loadTranscript, summarizeSession]) {
      expect(await run(locked, { path: "/export/session.jsonl" }, options)).toEqual({
        ok: false,
        error: {
          _tag: "ReadFailed",
          path: "/export/session.jsonl",
          message: denied.message,
          cause: denied
        }
      });
    }
  });
});
