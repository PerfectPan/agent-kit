import { cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { type SessionPlatform } from "@rivus/agent-kit-sessions/public";
import { afterAll, describe, expect, it } from "vite-plus/test";

import { createMemoryPlatform, oversizedSession, sessionAdapterConformance } from "@rivus/agent-kit-testing/public";
import { geminiSessions } from "./support.js";
import { nodeReadFs, readTree } from "../../../testing/test/support.js";
import { geminiCliSessionAdapter } from "../src/sessions.js";

const fixtures = fileURLToPath(new URL("fixtures/sessions", import.meta.url));
const adapter = geminiCliSessionAdapter;
const oversizedLine = '{"id":"u-oversized","type":"user","content":"x","timestamp":"2026-01-01T00:00:00.000Z"}';

function describeConformance(name: string, setup: () => Promise<{ platform: SessionPlatform; root: string }>): void {
  describe(`gemini-cli sessions conformance (${name})`, async () => {
    const { platform, root } = await setup();
    const checks = sessionAdapterConformance(adapter, {
      platform,
      root: `${root}/conformance`,
      sessions: geminiSessions(`${root}`),
      oversized: { root: `${root}/oversized`, file: `${root}/oversized/chats/session-1.jsonl` }
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
      ...(await readTree(fixtures, "/gemini")),
      "/gemini/oversized/chats/session-1.jsonl": oversizedSession(oversizedLine)
    },
    // Small chunks make every read cross chunk boundaries.
    chunkSize: 1000
  }),
  root: "/gemini"
}));

const tempRoot = await mkdtemp(join(tmpdir(), "agent-kit-gemini-cli-"));
afterAll(() => rm(tempRoot, { recursive: true, force: true }));

describeConformance("node fs on a temporary directory", async () => {
  await cp(fixtures, tempRoot, { recursive: true });
  await mkdir(join(tempRoot, "oversized/chats"), { recursive: true });
  await writeFile(join(tempRoot, "oversized/chats/session-1.jsonl"), oversizedSession(oversizedLine));
  return { platform: { fs: nodeReadFs() }, root: tempRoot };
});
