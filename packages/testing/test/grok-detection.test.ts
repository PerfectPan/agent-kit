import { describe, expect, it } from "vite-plus/test";
import type { FileStat } from "@rivus/agent-kit-platform";
import { loadTranscript, summarizeSession } from "@rivus/agent-kit-sessions";
import { createMemoryPlatform } from "@rivus/agent-kit-testing";
import { builtinCodingAgents as testIdentity, builtinSessionAdapters as testSessions } from "./providers.js";

describe("cross-agent Grok detection", () => {
  it("returns ReadFailed when summary.json cannot be stated and no agent is named", async () => {
    const dir = "/u/me/.grok/sessions/locked";
    const updates = `${dir}/updates.jsonl`;
    const base = createMemoryPlatform({
      files: {
        [updates]: '{"timestamp":"2026-01-01T00:00:00.000Z","params":{"update":{"sessionUpdate":"widget"}}}\n',
        [`${dir}/summary.json`]: "{}"
      },
      home: "/u/me"
    });
    const denied = Object.assign(new Error("EACCES: permission denied"), { code: "EACCES" });
    const platform = {
      ...base,
      fs: {
        ...base.fs,
        async stat(path: string, options?: { readonly followSymlinks?: boolean }): Promise<FileStat | undefined> {
          if (path.endsWith("/summary.json")) {
            throw denied;
          }
          return base.fs.stat(path, options);
        }
      }
    };
    const named = await loadTranscript(
      platform,
      { agent: "grok", path: updates },
      { providers: { sessions: testSessions, identity: testIdentity } }
    );
    const detected = await loadTranscript(
      platform,
      { path: updates },
      { providers: { sessions: testSessions, identity: testIdentity } }
    );
    const namedSummary = await summarizeSession(
      platform,
      { agent: "grok", path: updates },
      { providers: { sessions: testSessions, identity: testIdentity } }
    );
    const detectedSummary = await summarizeSession(
      platform,
      { path: updates },
      { providers: { sessions: testSessions, identity: testIdentity } }
    );
    expect(named).toEqual(detected);
    expect(namedSummary).toEqual(named);
    expect(detectedSummary).toEqual(named);
    expect(named).toEqual({
      ok: false,
      error: { _tag: "ReadFailed", path: updates, message: denied.message, cause: denied }
    });
  });
});
