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

describe("dsh unknown event types", () => {
  it("emits an unknown event instead of dropping a type outside the bookkeeping set", async () => {
    const platform = createMemoryPlatform({ files: await readTree(fixtures, "/dsh") });
    const result = await adapter.load(platform, {
      agent: "dsh",
      path: "/dsh/conformance/unknown-type/session.v4.jsonl"
    });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    const unknown = result.value.events.filter((event) => event.kind === "unknown");
    expect(unknown).toHaveLength(1);
    expect(unknown[0]).toMatchObject({ payload: { type: "extension/thing" } });
  });
});

describe("dsh request timing", () => {
  it("computes durationMs from step/start or first stream record to last stream record, and omits it without timed records", async () => {
    const platform = createMemoryPlatform({ files: await readTree(fixtures, "/dsh") });
    const timedRef = { agent: "dsh" as const, path: "/dsh/conformance/timed/session.v4.jsonl" };
    const loaded = await adapter.load(platform, timedRef);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) {
      return;
    }
    expect(loaded.value.capabilities).toContain("durations");
    const requests = loaded.value.events.filter((event) => event.kind === "request");
    expect(requests.map((event) => event.payload.durationMs)).toEqual([1450, 350, undefined]);

    const summary = await adapter.summarize?.(platform, timedRef);
    expect(summary?.ok).toBe(true);
    if (summary?.ok) {
      expect(summary.value.durationMs).toBe(1800);
    }

    const plainRef = { agent: "dsh" as const, path: "/dsh/conformance/plain/session.v4.jsonl" };
    const plain = await adapter.load(platform, plainRef);
    expect(plain.ok).toBe(true);
    if (!plain.ok) {
      return;
    }
    expect(plain.value.capabilities).not.toContain("durations");
    expect(plain.value.events.filter((event) => event.kind === "request").map((e) => e.payload.durationMs)).toEqual([
      undefined,
      undefined
    ]);
  });

  it("leaves durationMs absent when stream ends before step/start", async () => {
    const log = [
      '{"type":"session","version":4,"id":"dsh-skew","createdAt":1767225600000,"cwd":"/u/me/work"}',
      '{"type":"step/start","seq":1,"time":1767225605000,"data":{"turn":1,"step":1}}',
      '{"type":"assistant/message","seq":2,"time":1767225604000,"data":{"turn":1,"step":1,"message":{"role":"assistant","content":[{"type":"text","text":"skew"}],"source":{"kind":"model","model":"m"}},"stream":[{"type":"chunk","time":1767225604000,"chunk":{"type":"finish"}}]}}'
    ].join("\n");
    const path = "/dsh/skew/session.v4.jsonl";
    const platform = createMemoryPlatform({ files: { [path]: new TextEncoder().encode(log) } });
    const loaded = await adapter.load(platform, { agent: "dsh", path });
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) {
      return;
    }
    expect(loaded.value.capabilities).not.toContain("durations");
    const request = loaded.value.events.find((event) => event.kind === "request");
    expect(request?.kind === "request" ? request.payload.durationMs : "missing").toBeUndefined();
  });

  it("handles signed negative dt deltas and skips batched records with missing or malformed dt", async () => {
    const log = [
      '{"type":"session","version":4,"id":"dsh-dt","createdAt":1767225600000,"cwd":"/u/me/work"}',
      '{"type":"step/start","seq":1,"time":900,"data":{"turn":1,"step":1}}',
      '{"type":"assistant/message","seq":2,"time":1100,"data":{"turn":1,"step":1,"message":{"role":"assistant","content":[{"type":"text","text":"abc"}],"source":{"kind":"model","model":"m"}},"stream":[{"type":"text-chunks","time0":1000,"index":0,"dt":[-100,200],"texts":["a","b","c"]}]}}',
      '{"type":"step/start","seq":3,"time":2000,"data":{"turn":2,"step":1}}',
      '{"type":"assistant/message","seq":4,"time":2200,"data":{"turn":2,"step":1,"message":{"role":"assistant","content":[{"type":"text","text":"x"}],"source":{"kind":"model","model":"m"}},"stream":[{"type":"text-chunks","time0":2100,"index":0,"dt":[],"texts":["x"]}]}}',
      '{"type":"step/start","seq":5,"time":3000,"data":{"turn":3,"step":1}}',
      '{"type":"assistant/message","seq":6,"time":3200,"data":{"turn":3,"step":1,"message":{"role":"assistant","content":[{"type":"text","text":"bad"}],"source":{"kind":"model","model":"m"}},"stream":[{"type":"text-chunks","time0":3100,"index":0,"dt":["bad"],"texts":["a","b"]}]}}',
      '{"type":"step/start","seq":7,"time":4000,"data":{"turn":4,"step":1}}',
      '{"type":"assistant/message","seq":8,"time":4200,"data":{"turn":4,"step":1,"message":{"role":"assistant","content":[{"type":"text","text":"missing"}],"source":{"kind":"model","model":"m"}},"stream":[{"type":"text-chunks","time0":4100,"index":0,"texts":["a"]}]}}'
    ].join("\n");
    const path = "/dsh/dt-edge/session.v4.jsonl";
    const platform = createMemoryPlatform({ files: { [path]: new TextEncoder().encode(log) } });
    const loaded = await adapter.load(platform, { agent: "dsh", path });
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) {
      return;
    }
    expect(loaded.value.capabilities).toContain("durations");
    const requests = loaded.value.events.filter((event) => event.kind === "request");
    expect(requests.map((event) => event.payload.durationMs)).toEqual([200, 100, undefined, undefined]);
  });
});

describe("dsh discovery keeps one generation per session", () => {
  const v3 = '{"type":"session","version":3,"id":"old","createdAt":1,"cwd":"/u/me/work"}\n';
  const v4 = '{"type":"session","version":4,"id":"new","createdAt":2,"cwd":"/u/me/work"}\n';
  const encode = (text: string) => new TextEncoder().encode(text);

  it("lists only the newest generation when both remain in one directory", async () => {
    const platform = createMemoryPlatform({
      files: {
        "/dsh/gens/-u-me-work-/s1/session.v3.jsonl": encode(v3),
        "/dsh/gens/-u-me-work-/s1/session.v4.jsonl": encode(v4)
      }
    });
    const heads = [];
    for await (const item of adapter.discover(platform, "/dsh/gens")) {
      heads.push(item);
    }
    expect(heads.map((head) => head.ref.path)).toEqual(["/dsh/gens/-u-me-work-/s1/session.v4.jsonl"]);
  });

  it("still lists a lone older generation, which load then reports", async () => {
    const path = "/dsh/gens/-u-me-work-/s2/session.v3.jsonl";
    const platform = createMemoryPlatform({ files: { [path]: encode(v3) } });
    const heads = [];
    for await (const item of adapter.discover(platform, "/dsh/gens")) {
      heads.push(item);
    }
    expect(heads.map((head) => head.ref.path)).toEqual([path]);
    const loaded = await adapter.load(platform, { agent: "dsh", path });
    expect(loaded.ok).toBe(false);
    if (!loaded.ok) {
      expect(loaded.error._tag).toBe("UnknownFormatGeneration");
    }
  });
});
