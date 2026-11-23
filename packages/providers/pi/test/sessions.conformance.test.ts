import { cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { type SessionPlatform, isSessionHead } from "@rivus/agent-kit-sessions/public";
import { afterAll, describe, expect, it } from "vite-plus/test";

import { createMemoryPlatform } from "@rivus/agent-kit-testing/public";
import { oversizedSession, sessionAdapterConformance } from "@rivus/agent-kit-testing/public";
import { piSessions } from "./support.js";
import { nodeReadFs, readTree } from "../../../testing/test/support.js";
import { piSessionAdapter } from "../src/sessions.js";

const fixtures = fileURLToPath(new URL("fixtures/sessions", import.meta.url));
const adapter = piSessionAdapter;
const oversizedLine =
  '{"type":"message","id":"big","parentId":null,"timestamp":"2026-01-01T00:00:00.000Z","message":{"role":"user","content":"x"}}';

function describeConformance(name: string, setup: () => Promise<{ platform: SessionPlatform; root: string }>): void {
  describe(`pi conformance (${name})`, async () => {
    const { platform, root } = await setup();
    const checks = sessionAdapterConformance(adapter, {
      platform,
      root: `${root}/conformance`,
      sessions: piSessions(`${root}/conformance`),
      oversized: { root: `${root}/oversized`, file: `${root}/oversized/session.jsonl` }
    });
    for (const { name: check, run } of checks) {
      it(`${check}`, async () => {
        await expect(run()).resolves.toBeUndefined();
      });
    }
  });
}

describeConformance("memory platform", async () => ({
  platform: createMemoryPlatform({
    files: {
      ...(await readTree(fixtures, "/pi")),
      "/pi/oversized/session.jsonl": oversizedSession(oversizedLine)
    },
    // Small chunks make every read cross chunk boundaries.
    chunkSize: 1000
  }),
  root: "/pi"
}));

const tempRoot = await mkdtemp(join(tmpdir(), "agent-kit-pi-"));
afterAll(() => rm(tempRoot, { recursive: true, force: true }));

describeConformance("temp directory", async () => {
  await cp(fixtures, tempRoot, { recursive: true });
  await mkdir(join(tempRoot, "oversized"));
  await writeFile(join(tempRoot, "oversized/session.jsonl"), oversizedSession(oversizedLine));
  return { platform: { fs: nodeReadFs() }, root: tempRoot };
});

describe("pi unknown generations fail loud", () => {
  it("refuses a version it does not read", async () => {
    const platform = createMemoryPlatform({ files: await readTree(fixtures, "/pi") });
    const result = await adapter.load(platform, { agent: "pi", path: "/pi/unknown-generation/session.jsonl" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error._tag).toBe("UnknownFormatGeneration");
    }
  });
});

describe("pi system prompt replay", () => {
  it("replays system message deltas into prompt snapshots and restarts from a compaction checkpoint", async () => {
    const platform = createMemoryPlatform({ files: await readTree(fixtures, "/pi") });
    const result = await adapter.load(platform, { agent: "pi", path: "/pi/conformance/prompt/session.jsonl" });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    const snapshots = result.value.events.filter(
      (event) => event.kind === "system" && event.payload.type === "prompt_snapshot"
    );
    const names = (tools: unknown): string[] => (tools as { name: string }[]).map((tool) => tool.name);
    expect(snapshots.map((event) => event.source.line)).toEqual([3, 6, 8]);

    // The leading message declares its sections in order; an empty section and a removed one render nothing.
    expect(snapshots[0]!.payload.systemPrompt).toBe(
      "You are a coding agent.\n\nUse read for files.\n\nFollow AGENTS.md."
    );
    expect(names(snapshots[0]!.payload.tools)).toEqual(["read", "bash"]);

    // The delta appends its content, replaces `rules`, removes `docs`, adds `skills`, drops `bash` and adds `write`
    // after the surviving `read`.
    const delta = snapshots[1]!.payload;
    expect(delta.systemPrompt).toBe(
      "Keep answers short.\n\nYou are a coding agent.\n\nUse read for files.\n\nFollow AGENTS.md and CLAUDE.md.\n\n## Skills\n- deploy"
    );
    expect(names(delta.tools)).toEqual(["read", "write"]);

    // The compaction shadows the leading snapshot and carries the checkpoint as its second event, which the session takes.
    const compaction = result.value.events.find((event) => event.kind === "compaction");
    expect(compaction).toBeDefined();
    expect(snapshots[0]!.shadowedBy).toBe(compaction!.id);
    expect(snapshots[1]!.shadowedBy).toBeUndefined();
    expect(snapshots[2]!.id).toBe(`${compaction!.id}:1`);
    expect(snapshots[2]!.payload).toEqual(delta);
    expect(result.value.session.systemPrompt).toBe(delta.systemPrompt);
    expect(result.value.session.tools).toEqual(delta.tools);
    expect(result.value.capabilities).toEqual([
      "requests",
      "usage",
      "compaction",
      "compactionTokens",
      "systemPrompt",
      "toolSchemas"
    ]);
  });

  it("lists neither the prompt nor the tools when no system message records them", async () => {
    const platform = createMemoryPlatform({ files: await readTree(fixtures, "/pi") });
    const result = await adapter.load(platform, { agent: "pi", path: "/pi/conformance/plain/session.jsonl" });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.session.systemPrompt).toBeUndefined();
    expect(result.value.session.tools).toBeUndefined();
    expect(result.value.capabilities).not.toContain("systemPrompt");
    expect(result.value.capabilities).not.toContain("toolSchemas");
  });
});

describe("pi discovery preview", () => {
  it("carries the fixture's session_info title on the discovered head", async () => {
    const platform = createMemoryPlatform({ files: await readTree(fixtures, "/pi") });
    const heads = [];
    for await (const item of adapter.discover(platform, "/pi/conformance")) {
      heads.push(item);
    }
    const plain = heads.find((item) => item.ref.path === "/pi/conformance/plain/session.jsonl");
    expect(plain).toBeDefined();
    expect(plain !== undefined && isSessionHead(plain) && plain.title).toBe("Plain session");
  });
});
