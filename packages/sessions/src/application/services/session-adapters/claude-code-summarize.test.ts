import { describe, expect, it } from "vite-plus/test";

import type { SessionRef } from "../../../domain/session/index.js";
import type { SessionPlatform } from "../../ports.js";
import { claudeCodeSessionAdapter } from "./claude-code.js";

const encoder = new TextEncoder();

const ref: SessionRef = { agent: "claude-code", path: "/s.jsonl" };

const userRecord = (uuid: string, extra: Record<string, unknown> = {}): string =>
  JSON.stringify({
    type: "user",
    uuid,
    timestamp: "2026-01-01T00:00:00.000Z",
    sessionId: "s",
    version: "2.0.0",
    message: { role: "user", content: "hello" },
    ...extra
  });

/** A platform whose sessions are the given files and whose `read` records which iterators were closed. */
function fakeClaudeCode(
  files: Record<string, string>,
  abort?: { path: string; afterBytes: number }
): { platform: SessionPlatform; closed: string[]; signal: AbortSignal } {
  const closed: string[] = [];
  const controller = new AbortController();
  const platform: SessionPlatform = {
    fs: {
      async stat(path) {
        if (files[path] !== undefined) {
          return { kind: "file", size: encoder.encode(files[path]!).byteLength, mtimeMs: 7 };
        }
        const below = Object.keys(files).some((file) => file.startsWith(`${path}/`));
        return below ? { kind: "dir", size: 0, mtimeMs: 7 } : undefined;
      },
      async list(dir) {
        const entries = new Map<string, "dir" | "file">();
        for (const file of Object.keys(files)) {
          if (!file.startsWith(`${dir}/`)) {
            continue;
          }
          const rest = file.slice(dir.length + 1);
          const slash = rest.indexOf("/");
          entries.set(slash === -1 ? rest : rest.slice(0, slash), slash === -1 ? "file" : "dir");
        }
        return [...entries].map(([name, kind]) => ({ name, kind }));
      },
      async *read(path) {
        const text = files[path];
        if (text === undefined) {
          throw Object.assign(new Error(`ENOENT: ${path}`), { code: "ENOENT" });
        }
        const bytes = encoder.encode(text);
        const split = abort?.path === path ? Math.min(abort.afterBytes, bytes.byteLength) : bytes.byteLength;
        try {
          yield bytes.slice(0, split);
          if (abort?.path === path) {
            controller.abort();
          }
          if (split < bytes.byteLength) {
            yield bytes.slice(split);
          }
        } finally {
          closed.push(path);
        }
      }
    }
  };
  return { platform, closed, signal: controller.signal };
}

const GOOD_SUB = "/s/subagents/agent-a.jsonl";
const OTHER_SUB = "/s/subagents/agent-b.jsonl";
const files = (main: string): Record<string, string> => ({
  "/s.jsonl": main,
  [GOOD_SUB]: [userRecord("a1", { agentId: "a" }), userRecord("a2", { agentId: "a" })].join("\n") + "\n",
  [OTHER_SUB]: userRecord("b1", { agentId: "b" }) + "\n"
});

describe("claudeCodeSessionAdapter.summarize", () => {
  it("closes every reader when a record is an unknown format generation", async () => {
    const fake = fakeClaudeCode(
      files([userRecord("u1"), JSON.stringify({ type: "user", version: 7 })].join("\n") + "\n")
    );
    const summarized = await claudeCodeSessionAdapter.summarize!(fake.platform, ref);
    expect(summarized.ok).toBe(false);
    if (!summarized.ok) {
      expect(summarized.error._tag).toBe("UnknownFormatGeneration");
    }
    expect(fake.closed).toStrictEqual(["/s.jsonl", GOOD_SUB, OTHER_SUB].toSorted());
  });

  it("closes every reader when the read is aborted mid-file", async () => {
    const main = [userRecord("u1"), userRecord("u2"), userRecord("u3")].join("\n") + "\n";
    const fake = fakeClaudeCode(files(main), { path: "/s.jsonl", afterBytes: main.indexOf("\n") + 1 });
    const rejection = await claudeCodeSessionAdapter.summarize!(fake.platform, ref, { signal: fake.signal }).then(
      (): unknown => undefined,
      (error: unknown): unknown => error
    );
    expect(rejection).toBeInstanceOf(Error);
    expect((rejection as Error).name).toBe("AbortError");
    expect(fake.closed).toStrictEqual(["/s.jsonl", GOOD_SUB, OTHER_SUB].toSorted());
  });
});
