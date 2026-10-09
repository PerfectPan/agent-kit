import { fileURLToPath } from "node:url";

import { builtinSessionAdapters, readText, type SessionAdapter, type Transcript } from "@rivus/agent-kit-sessions";
import { describe, expect, it } from "vite-plus/test";

import { createMemoryPlatform } from "../src/memory-platform.js";
import { oversizedSession, sessionAdapterConformance } from "../src/session-adapter-conformance.js";
import { claudeCodeSessions, readTree } from "./support.js";

// Each broken adapter differs from the Claude Code one in a single way; the named check must reject it.

const claude = builtinSessionAdapters["claude-code"];
const platform = createMemoryPlatform({
  files: {
    ...(await readTree(fileURLToPath(new URL("fixtures/claude-code/conformance", import.meta.url)), "/c")),
    "/big/session.jsonl": oversizedSession('{"type":"user","sessionId":"b","message":{"content":"x"}}')
  }
});
const fixtures = {
  platform,
  root: "/c",
  sessions: claudeCodeSessions("/c"),
  oversized: { root: "/big", file: "/big/session.jsonl" }
};

function withLoad(change: (transcript: Transcript) => void): SessionAdapter {
  return {
    ...claude,
    async load(on, ref, options) {
      const transcript = await claude.load(on, ref, options);
      if (transcript.ok) {
        change(transcript.value);
      }
      return transcript;
    }
  };
}

async function failure(adapter: SessionAdapter, name: string): Promise<string> {
  const check = sessionAdapterConformance(adapter, fixtures).find((candidate) => candidate.name === name);
  expect(check).toBeDefined();
  try {
    await check!.run();
  } catch (error) {
    return (error as Error).message;
  }
  return "passed";
}

describe("sessionAdapterConformance", () => {
  it("rejects a discover that reads whole files", async () => {
    const greedy: SessionAdapter = {
      ...claude,
      async *discover(on, root, options) {
        for await (const item of claude.discover(on, root, options)) {
          await readText(on, item.ref.path);
          yield item;
        }
      }
    };
    const name = "reads at most 64 KB from each end of a large session";
    expect(await failure(claude, name)).toBe("passed");
    expect(await failure(greedy, name)).toMatch(/read \d+ bytes/);
  });

  const requests = (t: Transcript) => t.events.filter((event) => event.kind === "request");
  it.each<[string, string, (transcript: Transcript) => void]>([
    ["a dropped record", "accounts for every input record", (t) => void t.events.splice(0, 1)],
    ["a wrong seq", "seq matches the event index", (t) => void (t.events[1]!.seq = 0)],
    [
      "a dangling parent",
      "resolves every reference between events and lanes",
      (t) => void (t.events[0]!.parentId = "x")
    ],
    [
      "a spawnEventId that names a missing event",
      "resolves every reference between events and lanes",
      (t) => {
        const lane = t.agents.find((agent) => agent.spawnEventId !== undefined);
        if (lane) {
          lane.spawnEventId = "missing";
        }
      }
    ],
    ["an unknown lane", "resolves every reference between events and lanes", (t) => void (t.events[0]!.agentId = "x")],
    [
      "a missing orphan flag",
      "pairs tool results or flags them orphan",
      (t) => void (t.events.find((event) => event.kind === "tool_call")!.payload.callId = "renamed")
    ],
    [
      "an undeclared capability",
      "shows each claimed capability and no undeclared one",
      (t) => void t.capabilities.push("systemPrompt")
    ],
    [
      "null usage",
      "shows each claimed capability and no undeclared one",
      (t) => requests(t).forEach((event) => void (event.payload.usage = null))
    ],
    [
      "no shadowing after a compaction",
      "points shadowedBy at a later compaction on the same lane",
      (t) => t.events.forEach((event) => delete event.shadowedBy)
    ],
    [
      "a shifted source pointer",
      "reads each source pointer back to original",
      (t) => void (t.events[0]!.source = { ...t.events[0]!.source, offset: t.events[0]!.source.offset + 1 })
    ]
  ])("rejects %s through the check that owns it", async (_defect, name, change) => {
    expect(await failure(claude, name)).toBe("passed");
    expect(await failure(withLoad(change), name)).not.toBe("passed");
  });
});
