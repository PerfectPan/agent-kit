import { describe, expect, it } from "vitest";

import type { SessionHead, SessionListFailure } from "../../domain/session/index.js";
import { discoverSessions } from "./discover-sessions.js";
import type { SessionPlatform } from "../ports.js";

const encoder = new TextEncoder();
const content = encoder.encode('{"sessionId":"s"}\n');

/** /r/good/s.jsonl is readable; listing /r/bad fails the way an unreadable directory does. */
const platform: SessionPlatform = {
  fs: {
    async stat(path) {
      return path.endsWith(".jsonl")
        ? { kind: "file", size: content.length, mtimeMs: 7 }
        : { kind: "dir", size: 0, mtimeMs: 7 };
    },
    async list(dir) {
      if (dir === "/r") {
        return [
          { name: "good", kind: "dir" },
          { name: "bad", kind: "dir" }
        ];
      }
      if (dir === "/r/good") {
        return [{ name: "s.jsonl", kind: "file" }];
      }
      throw Object.assign(new Error(`EACCES: ${dir}`), { code: "EACCES" });
    },
    async *read() {
      yield content;
    }
  }
};

async function discover(root: string): Promise<(SessionHead | SessionListFailure)[]> {
  const items: (SessionHead | SessionListFailure)[] = [];
  const options = { files: { match: (name: string) => name.endsWith(".jsonl"), maxDepth: 3 }, preview: () => ({}) };
  for await (const item of discoverSessions(platform, "demo", root, options)) {
    items.push(item);
  }
  return items;
}

describe("discoverSessions", () => {
  it("reports an unreadable directory as its own failure and keeps the sessions found elsewhere", async () => {
    expect(await discover("/r")).toEqual([
      {
        ref: { agent: "demo", path: "/r/bad" },
        error: expect.objectContaining({ _tag: "ReadFailed", path: "/r/bad", message: "EACCES: /r/bad" })
      },
      { ref: { agent: "demo", path: "/r/good/s.jsonl" }, lastActiveAt: 7, sizeBytes: content.length }
    ]);
  });

  it("reports a root that cannot be listed as one failure", async () => {
    expect(await discover("/r/bad")).toEqual([
      { ref: { agent: "demo", path: "/r/bad" }, error: expect.objectContaining({ _tag: "ReadFailed" }) }
    ]);
  });
});
