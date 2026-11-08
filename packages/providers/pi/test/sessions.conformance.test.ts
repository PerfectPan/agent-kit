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
