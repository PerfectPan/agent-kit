import { builtinSessionAdapters as testSessions, builtinCodingAgents as testIdentity } from "./providers.js";
import { fileURLToPath } from "node:url";
import type { Result } from "@rivus/agent-kit-catalog";
import { loadTranscript, summarizeSession } from "@rivus/agent-kit-sessions";
import { describe, expect, it } from "vite-plus/test";
import { createMemoryPlatform } from "../src/memory-platform.js";
import { readTree } from "./support.js";
const tree = await readTree(
  fileURLToPath(new URL("../../providers/codex/test/fixtures/sessions", import.meta.url)),
  "/u/me/.codex/fx"
);
const platform = createMemoryPlatform({ files: tree, home: "/u/me" });
const rollout = (name: string) => `/u/me/.codex/fx/conformance/rollout-${name}.jsonl`;
function value<T>(result: Result<T, unknown>): T {
  if (!result.ok) {
    throw new Error(`unexpected failure: ${JSON.stringify(result.error)}`);
  }
  return result.value;
}
function failing(error: Error): AsyncIterable<Uint8Array> {
  return {
    [Symbol.asyncIterator]: () => ({
      next: async () => {
        throw error;
      }
    })
  };
}
describe("sessions use cases over Codex", () => {
  it("detects a Codex session without a named agent and summarizes it like folding its transcript", async () => {
    const copy = createMemoryPlatform({ files: { "/x/session.jsonl": tree[rollout("plain")]! } });
    expect(
      value(
        await loadTranscript(
          copy,
          { path: "/x/session.jsonl" },
          { providers: { sessions: testSessions, identity: testIdentity } }
        )
      ).agent
    ).toBe("codex");
    expect(
      value(
        await summarizeSession(
          platform,
          { agent: "codex", path: rollout("plain") },
          { providers: { sessions: testSessions, identity: testIdentity } }
        )
      )
    ).toEqual({
      turns: 1,
      requests: 2,
      inputTokens: 32,
      outputTokens: 8,
      durationMs: 6500,
      compactions: 0,
      subagents: 0,
      failedTools: 1,
      contextShape: [12, 20]
    });
  });

  it("returns ReadFailed when automatic detection cannot read an exported session", async () => {
    const denied = Object.assign(new Error("EACCES: permission denied"), { code: "EACCES" });
    const exported = createMemoryPlatform({ files: { "/export/session.jsonl": "{}\n" } });
    const locked = { fs: { ...exported.fs, read: () => failing(denied) } };
    const options = { providers: { sessions: { codex: testSessions["codex"] }, identity: testIdentity } };
    for (const run of [loadTranscript, summarizeSession]) {
      expect(await run(locked, { path: "/export/session.jsonl" }, options)).toEqual({
        ok: false,
        error: { _tag: "ReadFailed", path: "/export/session.jsonl", message: denied.message, cause: denied }
      });
    }
  });
});
