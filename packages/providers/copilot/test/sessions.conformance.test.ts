import { cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { homeFromRule } from "@rivus/agent-kit-catalog/spi";
import { type SessionPlatform } from "@rivus/agent-kit-sessions/public";
import {
  createMemoryPlatform,
  oversizedSession,
  sessionAdapterConformance,
  usageDecoderConformance
} from "@rivus/agent-kit-testing/public";
import { afterAll, describe, expect, it } from "vite-plus/test";
import { nodeReadFs, readTree } from "../../../testing/test/support.js";
import { copilot } from "../src/identity.js";
import { copilotSessionAdapter } from "../src/sessions.js";
import { copilotUsageDecoder } from "../src/usage.js";

const fixtures = fileURLToPath(new URL("fixtures", import.meta.url));
const oversizedLine =
  '{"type":"session.info","id":"e-x","timestamp":"2026-11-24T12:00:00.000Z","parentId":null,"data":{"message":"ok"}}';

function oversizedAt(root: string): { root: string; file: string; dir: string } {
  const dir = `${root}/oversized/session-state/sess-x`;
  return { root: `${root}/oversized/session-state`, file: `${dir}/events.jsonl`, dir };
}

function describeConformance(name: string, setup: () => Promise<{ platform: SessionPlatform; root: string }>): void {
  describe(`copilot conformance (${name})`, async () => {
    const { platform, root } = await setup();
    const state = `${root}/session-state`;
    const checks = sessionAdapterConformance(copilotSessionAdapter, {
      platform,
      root: state,
      sessions: [
        {
          path: `${state}/sess-1/events.jsonl`,
          records: 19,
          capabilities: [
            "requests",
            "usage",
            "durations",
            "reasoning",
            "compaction",
            "compactionTokens",
            "hooks",
            "subagents",
            "systemPrompt"
          ]
        }
      ],
      oversized: oversizedAt(root)
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
      ...(await readTree(fixtures, "/copilot")),
      [oversizedAt("/copilot").file]: oversizedSession(oversizedLine)
    },
    chunkSize: 1000
  }),
  root: "/copilot"
}));

const tempRoot = await mkdtemp(join(tmpdir(), "agent-kit-copilot-"));
afterAll(() => rm(tempRoot, { recursive: true, force: true }));

describeConformance("temp directory", async () => {
  await cp(fixtures, tempRoot, { recursive: true });
  const oversized = oversizedAt(tempRoot);
  await mkdir(oversized.dir, { recursive: true });
  await writeFile(oversized.file, oversizedSession(oversizedLine));
  return { platform: { fs: nodeReadFs() }, root: tempRoot };
});

const usagePlatform = createMemoryPlatform({
  files: await readTree(fixtures, "/copilot"),
  chunkSize: 1000
});
const usageFixtures = {
  platform: usagePlatform,
  home: homeFromRule("copilot", copilot.home, { home: "/copilot", env: { COPILOT_HOME: "/copilot" } }),
  sources: [
    {
      path: "/copilot/session-state/sess-1/events.jsonl",
      records: 4
    }
  ]
};

describe("copilot usage conformance", () => {
  for (const { name, run } of usageDecoderConformance(copilotUsageDecoder, usageFixtures)) {
    it(`${name}`, async () => {
      await expect(run()).resolves.toBeUndefined();
    });
  }
});
