import { cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { type SessionPlatform } from "@rivus/agent-kit-sessions/public";
import { afterAll, describe, expect, it } from "vite-plus/test";

import { createMemoryPlatform, oversizedSession, sessionAdapterConformance } from "@rivus/agent-kit-testing/public";
import { nodeReadFs, readTree } from "../../../testing/test/support.js";
import { kimiSessionAdapter } from "../src/sessions.js";
import { homeFromRule } from "@rivus/agent-kit-catalog/spi";
import { kimiUsageDecoder } from "../src/usage.js";
import { kimi } from "../src/identity.js";
import { usageDecoderConformance } from "@rivus/agent-kit-testing/public";

const fixtures = fileURLToPath(new URL("fixtures", import.meta.url));
const adapter = kimiSessionAdapter;
// A repeated bookkeeping line keeps the oversized file a wire the preview gates through.
const oversizedLine =
  '{"type":"environment.set_binding","environmentId":"local","agentId":"main","time":1794500000000}';

function describeConformance(name: string, setup: () => Promise<{ platform: SessionPlatform; root: string }>): void {
  describe(`kimi conformance (${name})`, async () => {
    const { platform, root } = await setup();
    const checks = sessionAdapterConformance(adapter, {
      platform,
      root: `${root}/sessions`,
      sessions: [
        {
          path: `${root}/sessions/wd_demo_111111111111/session_demo-1/agents/main/wire.jsonl`,
          records: 21,
          capabilities: ["requests", "usage", "durations", "systemPrompt", "toolSchemas"]
        },
        {
          path: `${root}/sessions/wd_demo_111111111111/session_demo-2/agents/main/wire.jsonl`,
          records: 19,
          capabilities: ["requests", "usage", "durations", "systemPrompt"]
        }
      ],
      oversized: {
        root: `${root}/oversized/sessions`,
        file: `${root}/oversized/sessions/wd_x_111111111111/session_x/agents/main/wire.jsonl`
      }
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
      ...(await readTree(fixtures, "/kimi")),
      "/kimi/oversized/sessions/wd_x_111111111111/session_x/agents/main/wire.jsonl": oversizedSession(oversizedLine)
    },
    // Small chunks make every read cross chunk boundaries.
    chunkSize: 1000
  }),
  root: "/kimi"
}));

const tempRoot = await mkdtemp(join(tmpdir(), "agent-kit-kimi-"));
afterAll(() => rm(tempRoot, { recursive: true, force: true }));

describeConformance("temp directory", async () => {
  await cp(fixtures, tempRoot, { recursive: true });
  await mkdir(join(tempRoot, "oversized/sessions/wd_x_111111111111/session_x/agents/main"), { recursive: true });
  await writeFile(
    join(tempRoot, "oversized/sessions/wd_x_111111111111/session_x/agents/main/wire.jsonl"),
    oversizedSession(oversizedLine)
  );
  return { platform: { fs: nodeReadFs() }, root: tempRoot };
});

// The usage decoder reads the same fixtures: one record per finished step.
const usagePlatform = createMemoryPlatform({
  files: await readTree(fixtures, "/kimi"),
  chunkSize: 1000
});
const usageFixtures = {
  platform: usagePlatform,
  home: homeFromRule("kimi", kimi.home, { home: "/kimi", env: { KIMI_CODE_HOME: "/kimi" } }),
  sources: [
    {
      path: "/kimi/sessions/wd_demo_111111111111/session_demo-1/agents/main/wire.jsonl",
      records: 1
    },
    {
      path: "/kimi/sessions/wd_demo_111111111111/session_demo-2/agents/main/wire.jsonl",
      records: 1
    }
  ]
};

describe("kimi usage conformance", () => {
  for (const { name, run } of usageDecoderConformance(kimiUsageDecoder, usageFixtures)) {
    it(`${name}`, async () => {
      await expect(run()).resolves.toBeUndefined();
    });
  }
});
