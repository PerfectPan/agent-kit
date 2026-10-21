import { codexSessions } from "./support.js";
import { codexSessionAdapter } from "../src/sessions.js";
import { cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { type SessionPlatform } from "@rivus/agent-kit-sessions/public";
import { afterAll, describe, expect, it } from "vite-plus/test";

import { createMemoryPlatform } from "@rivus/agent-kit-testing/public";
import { oversizedSession, sessionAdapterConformance } from "@rivus/agent-kit-testing/public";
import { nodeReadFs, readTree } from "../../../testing/test/support.js";

const fixtures = fileURLToPath(new URL("fixtures/sessions", import.meta.url));
const adapter = codexSessionAdapter;
const oversizedLine =
  '{"timestamp":"2026-01-01T00:00:00.000Z","type":"session_meta","payload":{"session_id":"big","cwd":"/work/app"}}';

function describeConformance(name: string, setup: () => Promise<{ platform: SessionPlatform; root: string }>): void {
  describe(`codex conformance (${name})`, async () => {
    const { platform, root } = await setup();
    const checks = sessionAdapterConformance(adapter, {
      platform,
      root: `${root}/conformance`,
      sessions: codexSessions(`${root}/conformance`),
      oversized: { root: `${root}/oversized`, file: `${root}/oversized/rollout-over.jsonl` }
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
      ...(await readTree(fixtures, "/codex")),
      "/codex/oversized/rollout-over.jsonl": oversizedSession(oversizedLine)
    },
    // Small chunks make every read cross chunk boundaries.
    chunkSize: 1000
  }),
  root: "/codex"
}));

const tempRoot = await mkdtemp(join(tmpdir(), "agent-kit-codex-"));
afterAll(() => rm(tempRoot, { recursive: true, force: true }));

describeConformance("temp directory", async () => {
  await cp(fixtures, tempRoot, { recursive: true });
  await mkdir(join(tempRoot, "oversized"));
  await writeFile(join(tempRoot, "oversized/rollout-over.jsonl"), oversizedSession(oversizedLine));
  return { platform: { fs: nodeReadFs() }, root: tempRoot };
});
