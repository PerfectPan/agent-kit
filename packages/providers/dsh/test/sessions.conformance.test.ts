import { cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { type SessionPlatform } from "@rivus/agent-kit-sessions/public";
import { afterAll, describe, expect, it } from "vite-plus/test";

import { createMemoryPlatform } from "@rivus/agent-kit-testing/public";
import { oversizedSession, sessionAdapterConformance } from "@rivus/agent-kit-testing/public";
import { dshSessions } from "./support.js";
import { nodeReadFs, readTree } from "../../../testing/test/support.js";
import { dshSessionAdapter } from "../src/sessions.js";

const fixtures = fileURLToPath(new URL("fixtures/sessions", import.meta.url));
const adapter = dshSessionAdapter;
const oversizedLine =
  '{"type":"user/message","seq":1,"time":1767225600000,"data":{"role":"user","content":[{"type":"text","text":"x"}],"source":{"kind":"user"}}}';

function describeConformance(name: string, setup: () => Promise<{ platform: SessionPlatform; root: string }>): void {
  describe(`dsh conformance (${name})`, async () => {
    const { platform, root } = await setup();
    const checks = sessionAdapterConformance(adapter, {
      platform,
      root: `${root}/conformance`,
      sessions: dshSessions(`${root}/conformance`),
      oversized: { root: `${root}/oversized`, file: `${root}/oversized/session.v4.jsonl` }
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
      ...(await readTree(fixtures, "/dsh")),
      "/dsh/oversized/session.v4.jsonl": oversizedSession(oversizedLine)
    },
    chunkSize: 1000
  }),
  root: "/dsh"
}));

const tempRoot = await mkdtemp(join(tmpdir(), "agent-kit-dsh-"));
afterAll(() => rm(tempRoot, { recursive: true, force: true }));

describeConformance("temp directory", async () => {
  await cp(fixtures, tempRoot, { recursive: true });
  await mkdir(join(tempRoot, "oversized"));
  await writeFile(join(tempRoot, "oversized/session.v4.jsonl"), oversizedSession(oversizedLine));
  return { platform: { fs: nodeReadFs() }, root: tempRoot };
});

describe("dsh unknown generations fail loud", () => {
  it("refuses a version it does not read", async () => {
    const platform = createMemoryPlatform({ files: await readTree(fixtures, "/dsh") });
    const result = await adapter.load(platform, {
      agent: "dsh",
      path: "/dsh/unknown-generation/session.v4.jsonl"
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error._tag).toBe("UnknownFormatGeneration");
    }
  });
});
