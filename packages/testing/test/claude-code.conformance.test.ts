import { cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { builtinSessionAdapters, type SessionPlatform } from "@rivus/agent-kit-sessions";
import { afterAll, describe, expect, it } from "vite-plus/test";

import { createMemoryPlatform } from "../src/memory-platform.js";
import { oversizedSession, sessionAdapterConformance } from "../src/session-adapter-conformance.js";
import { claudeCodeSessions, nodeReadFs, readTree } from "./support.js";

const fixtures = fileURLToPath(new URL("fixtures/claude-code", import.meta.url));
const adapter = builtinSessionAdapters["claude-code"];
const oversizedLine = '{"type":"user","timestamp":"2026-01-01T00:00:00.000Z","message":{"role":"user","content":"x"}}';

function describeConformance(name: string, setup: () => Promise<{ platform: SessionPlatform; root: string }>): void {
  describe(`claude-code conformance (${name})`, async () => {
    const { platform, root } = await setup();
    const checks = sessionAdapterConformance(adapter, {
      platform,
      root: `${root}/conformance`,
      sessions: claudeCodeSessions(`${root}/conformance`),
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
      ...(await readTree(fixtures, "/claude")),
      "/claude/oversized/session.jsonl": oversizedSession(oversizedLine)
    },
    // Small chunks make every read cross chunk boundaries.
    chunkSize: 1000
  }),
  root: "/claude"
}));

const tempRoot = await mkdtemp(join(tmpdir(), "agent-kit-claude-"));
afterAll(() => rm(tempRoot, { recursive: true, force: true }));

describeConformance("temp directory", async () => {
  await cp(fixtures, tempRoot, { recursive: true });
  await mkdir(join(tempRoot, "oversized"));
  await writeFile(join(tempRoot, "oversized/session.jsonl"), oversizedSession(oversizedLine));
  return { platform: { fs: nodeReadFs() }, root: tempRoot };
});
