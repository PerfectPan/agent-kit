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
import { agy } from "../src/identity.js";
import { agyInstallAdapter } from "../src/install.js";
import { agySessionAdapter } from "../src/sessions.js";
import { agyUsageDecoder } from "../src/usage.js";
import { nestedConversations } from "./fixtures/subagents.js";

const fixtures = fileURLToPath(new URL("fixtures", import.meta.url));
const oversizedLine =
  '{"step_index":0,"source":"SYSTEM","type":"SYSTEM_MESSAGE","status":"DONE","created_at":"2026-11-18T10:00:00Z","content":"ok"}';
const LOGS = ".system_generated/logs";

/** The oversized session under `root`: the root `discover` lists, its file and the directory holding it. */
function oversizedAt(root: string): { root: string; file: string; dir: string } {
  const dir = `${root}/oversized/antigravity-cli/brain/conv-x/${LOGS}`;
  return { root: `${root}/oversized/antigravity-cli/brain`, file: `${dir}/transcript_full.jsonl`, dir };
}

function describeConformance(name: string, setup: () => Promise<{ platform: SessionPlatform; root: string }>): void {
  describe(`agy conformance (${name})`, async () => {
    const { platform, root } = await setup();
    const brain = `${root}/antigravity-cli/brain`;
    const checks = sessionAdapterConformance(agySessionAdapter, {
      platform,
      root: brain,
      sessions: [
        {
          // The conversation and the subagent it spawned: `sub-1` is a lane of `conv-1`, not a session of its own.
          path: `${brain}/conv-1/${LOGS}/transcript_full.jsonl`,
          files: [`${brain}/conv-1/${LOGS}/transcript_full.jsonl`, `${brain}/sub-1/${LOGS}/transcript_full.jsonl`],
          records: 14,
          capabilities: ["requests", "usage", "reasoning", "compaction", "subagents"]
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
      ...(await readTree(fixtures, "/agy")),
      [oversizedAt("/agy").file]: oversizedSession(oversizedLine)
    },
    chunkSize: 1000
  }),
  root: "/agy"
}));

const tempRoot = await mkdtemp(join(tmpdir(), "agent-kit-agy-"));
afterAll(() => rm(tempRoot, { recursive: true, force: true }));

describeConformance("temp directory", async () => {
  await cp(fixtures, tempRoot, { recursive: true });
  const oversized = oversizedAt(tempRoot);
  await mkdir(oversized.dir, { recursive: true });
  await writeFile(oversized.file, oversizedSession(oversizedLine));
  return { platform: { fs: nodeReadFs() }, root: tempRoot };
});

// A root that spawns a nested subagent, a subagent without a transcript and the root itself again: the nested one
// is a lane of its own parent under the lanes order both passes share, the missing one is an unavailable lane, and
// the loop adds no lane.
describe("agy conformance (nested, missing and looping subagents)", async () => {
  const root = "/agy-nested";
  const brain = `${root}/antigravity-cli/brain`;
  const checks = sessionAdapterConformance(agySessionAdapter, {
    platform: createMemoryPlatform({
      files: { ...nestedConversations(brain), [oversizedAt(root).file]: oversizedSession(oversizedLine) },
      chunkSize: 1000
    }),
    root: brain,
    sessions: [
      {
        path: `${brain}/conv-root/${LOGS}/transcript.jsonl`,
        files: [
          `${brain}/conv-root/${LOGS}/transcript.jsonl`,
          `${brain}/sub-a/${LOGS}/transcript_full.jsonl`,
          `${brain}/sub-b/${LOGS}/transcript.jsonl`
        ],
        records: 13,
        capabilities: ["requests", "usage", "reasoning", "compaction", "subagents"]
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

const usagePlatform = createMemoryPlatform({
  files: await readTree(fixtures, "/agy"),
  chunkSize: 1000
});
const usageFixtures = {
  platform: usagePlatform,
  home: homeFromRule("agy", agy.home, { home: "/agy", env: { ANTIGRAVITY_GEMINI_DIR: "/agy" } }),
  // A subagent conversation's requests are billed like any other's, so its compact transcript is a usage source too.
  sources: [
    {
      path: "/agy/antigravity-cli/brain/conv-1/.system_generated/logs/transcript.jsonl",
      records: 4
    },
    {
      path: "/agy/antigravity-cli/brain/sub-1/.system_generated/logs/transcript.jsonl",
      records: 2
    }
  ]
};
describe("agy usage conformance", () => {
  for (const { name, run } of usageDecoderConformance(agyUsageDecoder, usageFixtures)) {
    it(`${name}`, async () => {
      await expect(run()).resolves.toBeUndefined();
    });
  }
});

describe("agy install adapter", () => {
  it("renders a native plugin with grouped tool hooks and flat lifecycle hooks", () => {
    const context = { home: "/u/me", env: {} };
    const bundle = { owner: "tools/acme", version: "1.0.0", digest: "sha256:0000" };
    const rendered = agyInstallAdapter.renderHooks(
      "native-plugin",
      [
        { event: "PreToolUse", command: "acme-hook pre", timeout: 10, agents: ["agy"] },
        { event: "SessionStart", command: "acme-hook start", agents: ["agy"] }
      ],
      bundle,
      context
    );
    expect(rendered).toHaveLength(1);
    const artifact = rendered[0]!;
    expect(artifact.locator).toEqual({ kind: "dir", path: "/u/me/.gemini/config/plugins/tools-acme" });
    const files = artifact.content as Record<string, string>;
    expect(JSON.parse(files["plugin.json"]!)).toEqual({ name: "tools-acme" });
    expect(JSON.parse(files["hooks.json"]!)).toEqual({
      "tools-acme": {
        PreToolUse: [{ matcher: "*", hooks: [{ type: "command", command: "acme-hook pre", timeout: 10 }] }],
        SessionStart: [{ type: "command", command: "acme-hook start" }]
      }
    });
  });
});
