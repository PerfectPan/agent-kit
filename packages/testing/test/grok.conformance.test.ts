import { cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { builtinSessionAdapters, type SessionPlatform } from "@rivus/agent-kit-sessions";
import { afterAll, describe, expect, it } from "vite-plus/test";

import { createMemoryPlatform } from "../src/memory-platform.js";
import { oversizedSession, sessionAdapterConformance } from "../src/session-adapter-conformance.js";
import { grokSessions, nodeReadFs, readTree } from "./support.js";

const fixtures = fileURLToPath(new URL("fixtures/grok", import.meta.url));
const adapter = builtinSessionAdapters.grok;
const oversizedLine =
  '{"timestamp":"2026-01-01T00:00:00.000Z","params":{"update":{"sessionUpdate":"user_message_chunk","content":{"type":"text","text":"x"}}}}';

function describeConformance(name: string, setup: () => Promise<{ platform: SessionPlatform; root: string }>): void {
  describe(`grok conformance (${name})`, async () => {
    const { platform, root } = await setup();
    const checks = sessionAdapterConformance(adapter, {
      platform,
      root: `${root}/conformance`,
      sessions: grokSessions(`${root}/conformance`),
      oversized: { root: `${root}/oversized`, file: `${root}/oversized/updates.jsonl` }
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
      ...(await readTree(fixtures, "/grok")),
      "/grok/oversized/updates.jsonl": oversizedSession(oversizedLine)
    },
    // Small chunks make every read cross chunk boundaries.
    chunkSize: 1000
  }),
  root: "/grok"
}));

const tempRoot = await mkdtemp(join(tmpdir(), "agent-kit-grok-"));
afterAll(() => rm(tempRoot, { recursive: true, force: true }));

describeConformance("temp directory", async () => {
  await cp(fixtures, tempRoot, { recursive: true });
  await mkdir(join(tempRoot, "oversized"));
  await writeFile(join(tempRoot, "oversized/updates.jsonl"), oversizedSession(oversizedLine));
  return { platform: { fs: nodeReadFs() }, root: tempRoot };
});
