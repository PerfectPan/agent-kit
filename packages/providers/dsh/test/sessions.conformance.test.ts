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

describe("dsh subagent lanes", () => {
  it("attaches spawn and fork children as lanes, strips inherited fork turns, and marks missing children unavailable", async () => {
    const platform = createMemoryPlatform({ files: await readTree(fixtures, "/dsh") });
    const ref = { agent: "dsh" as const, path: "/dsh/conformance/parent/session.v4.jsonl" };
    const loaded = await adapter.load(platform, ref);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) {
      return;
    }
    const transcript = loaded.value;
    expect(transcript.capabilities).toContain("subagents");
    expect(transcript.agents).toEqual([
      { id: "main" },
      { id: "spawn-child", parentId: "main", title: "Spawn worker" },
      { id: "fork-child", parentId: "main", title: "Fork worker" },
      { id: "missing-child", parentId: "main", title: "Missing worker", unavailable: true }
    ]);

    const spawnRequests = transcript.events.filter(
      (event) => event.kind === "request" && event.agentId === "spawn-child"
    );
    expect(spawnRequests).toHaveLength(1);
    expect(spawnRequests[0]?.kind === "request" ? spawnRequests[0].payload.responseId : undefined).toBe("m-spawn");

    const forkEvents = transcript.events.filter((event) => event.agentId === "fork-child");
    const forkRequests = forkEvents.filter((event) => event.kind === "request");
    expect(forkRequests).toHaveLength(1);
    expect(forkRequests[0]?.kind === "request" ? forkRequests[0].payload.responseId : undefined).toBe("m-fork");
    // Inherited parent prompt must not repeat in the fork child's lane.
    expect(forkEvents.some((event) => event.kind === "user" && event.payload.text === "delegate work")).toBe(false);
    expect(forkEvents.some((event) => event.kind === "user" && event.payload.text === "continue from fork")).toBe(true);

    const summary = await adapter.summarize?.(platform, ref);
    expect(summary?.ok).toBe(true);
    if (summary?.ok) {
      expect(summary.value.subagents).toBe(3);
      expect(summary.value.requests).toBe(4);
      expect(summary.value.turns).toBe(1);
    }
  });

  it("resolves a child session stored under a sibling project directory and hides only origin=subagent from discover", async () => {
    const encode = (text: string) => new TextEncoder().encode(text);
    const parentPath = "/dsh/sessions/--u-me-a--/p1/session.v4.jsonl";
    const childPath = "/dsh/sessions/--u-me-b--/c1/session.v4.jsonl";
    const manualForkPath = "/dsh/sessions/--u-me-a--/f1/session.v4.jsonl";
    const parentLog = [
      '{"type":"session","version":4,"id":"p1","createdAt":1000,"cwd":"/u/me/a"}',
      '{"type":"user/message","seq":1,"time":1001,"data":{"role":"user","content":[{"type":"text","text":"go"}],"source":{"kind":"user"}}}',
      '{"type":"subagent/catalog","seq":2,"time":1002,"data":{"version":0,"childId":"c1","childCreatedAt":1002,"mode":"continuable","label":"Other cwd"}}'
    ].join("\n");
    const childLog = [
      '{"type":"session","version":4,"id":"c1","createdAt":1002,"cwd":"/u/me/b","parentSession":"p1","origin":"subagent","isSeeded":false}',
      '{"type":"assistant/message","seq":1,"time":1003,"data":{"turn":1,"step":1,"message":{"role":"assistant","content":[{"type":"text","text":"hi"}],"source":{"kind":"model","model":"m"}},"usage":{"inputTokens":2,"outputTokens":1,"totalTokens":3}}}'
    ].join("\n");
    // A standalone manual fork carries parentSession without origin: "subagent" and must stay visible in discover.
    const manualForkLog = [
      '{"type":"session","version":4,"id":"f1","createdAt":1005,"cwd":"/u/me/a","parentSession":"p1","isSeeded":true}',
      '{"type":"user/message","seq":1,"time":1001,"data":{"role":"user","content":[{"type":"text","text":"go"}],"source":{"kind":"user"}}}',
      '{"type":"subagent/catalog","seq":2,"time":1002,"data":{"version":0,"childId":"c1","childCreatedAt":1002,"mode":"continuable","label":"Inherited child"}}',
      '{"type":"session/end-seed","seq":3,"time":1005,"data":{"inherited":true}}',
      '{"type":"user/message","seq":4,"time":1006,"data":{"role":"user","content":[{"type":"text","text":"fork own"}],"source":{"kind":"user"}}}'
    ].join("\n");
    const platform = createMemoryPlatform({
      files: {
        [parentPath]: encode(parentLog),
        [childPath]: encode(childLog),
        [manualForkPath]: encode(manualForkLog)
      }
    });

    const discovered = [];
    for await (const item of adapter.discover(platform, "/dsh/sessions")) {
      discovered.push(item.ref.path);
    }
    expect(discovered.sort()).toEqual([manualForkPath, parentPath]);

    const loaded = await adapter.load(platform, { agent: "dsh", path: parentPath });
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) {
      return;
    }
    expect(loaded.value.agents).toEqual([{ id: "main" }, { id: "c1", parentId: "main", title: "Other cwd" }]);
    expect(loaded.value.events.some((event) => event.kind === "request" && event.agentId === "c1")).toBe(true);

    // The standalone root fork retains its inherited history for display, but must NOT attach inherited catalog entries.
    const forkLoaded = await adapter.load(platform, { agent: "dsh", path: manualForkPath });
    expect(forkLoaded.ok).toBe(true);
    if (!forkLoaded.ok) {
      return;
    }
    expect(forkLoaded.value.agents).toEqual([{ id: "main" }]);
    expect(forkLoaded.value.capabilities).not.toContain("subagents");
    expect(forkLoaded.value.events.some((event) => event.kind === "user" && event.payload.text === "go")).toBe(true);
    expect(forkLoaded.value.events.some((event) => event.kind === "user" && event.payload.text === "fork own")).toBe(
      true
    );
  });

  it("strips inherited fork events even at the same millisecond as createdAt and ignores non-inherited resume markers", async () => {
    const encode = (text: string) => new TextEncoder().encode(text);
    const parentPath = "/dsh/same-ms/--u-me--/p1/session.v4.jsonl";
    const childPath = "/dsh/same-ms/--u-me--/c-fork/session.v4.jsonl";
    const parentLog = [
      '{"type":"session","version":4,"id":"p1","createdAt":5000,"cwd":"/u/me"}',
      '{"type":"user/message","seq":1,"time":5000,"data":{"role":"user","content":[{"type":"text","text":"same-ms parent"}],"source":{"kind":"user"}}}',
      '{"type":"assistant/message","seq":2,"time":5000,"data":{"turn":1,"step":1,"message":{"role":"assistant","content":[{"type":"text","text":"parent reply"}],"source":{"kind":"model","model":"m"}},"usage":{"inputTokens":4,"outputTokens":2,"totalTokens":6}}}',
      '{"type":"subagent/catalog","seq":3,"time":5000,"data":{"version":0,"childId":"c-fork","childCreatedAt":5000,"mode":"continuable","label":"Same-ms fork"}}'
    ].join("\n");
    const childLog = [
      '{"type":"session","version":4,"id":"c-fork","createdAt":5000,"cwd":"/u/me","parentSession":"p1","origin":"subagent","isSeeded":true}',
      '{"type":"session/end-seed","seq":0,"time":4900,"data":{"inherited":true}}',
      '{"type":"user/message","seq":1,"time":5000,"data":{"role":"user","content":[{"type":"text","text":"same-ms parent"}],"source":{"kind":"user"}}}',
      '{"type":"assistant/message","seq":2,"time":5000,"data":{"turn":1,"step":1,"message":{"role":"assistant","content":[{"type":"text","text":"parent reply"}],"source":{"kind":"model","model":"m"}},"usage":{"inputTokens":4,"outputTokens":2,"totalTokens":6}}}',
      '{"type":"session/end-seed","seq":3,"time":5000,"data":{"inherited":true}}',
      '{"type":"assistant/message","seq":4,"time":5000,"data":{"turn":2,"step":1,"message":{"role":"assistant","content":[{"type":"text","text":"child own reply"}],"source":{"kind":"model","model":"m"}},"usage":{"inputTokens":3,"outputTokens":1,"totalTokens":4}}}',
      '{"type":"session/end-seed","seq":5,"time":5100,"data":{}}',
      '{"type":"assistant/message","seq":6,"time":5200,"data":{"turn":3,"step":1,"message":{"role":"assistant","content":[{"type":"text","text":"after resume"}],"source":{"kind":"model","model":"m"}},"usage":{"inputTokens":2,"outputTokens":1,"totalTokens":3}}}'
    ].join("\n");
    const platform = createMemoryPlatform({
      files: { [parentPath]: encode(parentLog), [childPath]: encode(childLog) }
    });
    const loaded = await adapter.load(platform, { agent: "dsh", path: parentPath });
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) {
      return;
    }
    const childEvents = loaded.value.events.filter((event) => event.agentId === "c-fork");
    expect(childEvents.filter((event) => event.kind === "request")).toHaveLength(2);
    expect(childEvents.some((event) => event.kind === "user" && event.payload.text === "same-ms parent")).toBe(false);
    expect(childEvents.some((event) => event.kind === "assistant" && event.payload.text === "after resume")).toBe(true);

    const summary = await adapter.summarize?.(platform, { agent: "dsh", path: parentPath });
    expect(summary?.ok).toBe(true);
    if (summary?.ok) {
      expect(summary.value.requests).toBe(3);
    }
  });

  it("turns child directory stat failures into unavailable lanes without failing the parent and propagates abort", async () => {
    const encode = (text: string) => new TextEncoder().encode(text);
    const parentPath = "/dsh/err/--u-me--/p1/session.v4.jsonl";
    const okChildPath = "/dsh/err/--u-me--/ok-child/session.v4.jsonl";
    const parentLog = [
      '{"type":"session","version":4,"id":"p1","createdAt":1000,"cwd":"/u/me"}',
      '{"type":"subagent/catalog","seq":1,"time":1001,"data":{"version":0,"childId":"denied-child","mode":"continuable","label":"Denied"}}',
      '{"type":"subagent/catalog","seq":2,"time":1002,"data":{"version":0,"childId":"ok-child","mode":"continuable","label":"Allowed"}}'
    ].join("\n");
    const okChildLog = [
      '{"type":"session","version":4,"id":"ok-child","createdAt":1002,"cwd":"/u/me","parentSession":"p1","origin":"subagent","isSeeded":false}',
      '{"type":"assistant/message","seq":1,"time":1003,"data":{"turn":1,"step":1,"message":{"role":"assistant","content":[{"type":"text","text":"ok"}],"source":{"kind":"model","model":"m"}},"usage":{"inputTokens":1,"outputTokens":1,"totalTokens":2}}}'
    ].join("\n");
    const base = createMemoryPlatform({
      files: { [parentPath]: encode(parentLog), [okChildPath]: encode(okChildLog) }
    });
    const platform: SessionPlatform = {
      fs: {
        ...base.fs,
        stat: async (path, options) => {
          if (path.includes("denied-child")) {
            throw Object.assign(new Error("EACCES"), { code: "EACCES" });
          }
          return base.fs.stat(path, options);
        }
      }
    };
    const loaded = await adapter.load(platform, { agent: "dsh", path: parentPath });
    expect(loaded.ok).toBe(true);
    if (loaded.ok) {
      expect(loaded.value.agents).toEqual([
        { id: "main" },
        { id: "denied-child", parentId: "main", title: "Denied", unavailable: true },
        { id: "ok-child", parentId: "main", title: "Allowed" }
      ]);
    }
    const summary = await adapter.summarize?.(platform, { agent: "dsh", path: parentPath });
    expect(summary?.ok).toBe(true);
    if (summary?.ok) {
      expect(summary.value.subagents).toBe(2);
      expect(summary.value.requests).toBe(1);
    }

    const controller = new AbortController();
    controller.abort(new Error("stop-now"));
    await expect(
      adapter.load(platform, { agent: "dsh", path: parentPath }, { signal: controller.signal })
    ).rejects.toThrow("stop-now");
  });

  it("merges large sessions with children without hitting argument count limits", async () => {
    const encode = (text: string) => new TextEncoder().encode(text);
    const parentPath = "/dsh/large/--u-me--/p-big/session.v4.jsonl";
    const childPath = "/dsh/large/--u-me--/c-small/session.v4.jsonl";
    const lines = [
      '{"type":"session","version":4,"id":"p-big","createdAt":1000,"cwd":"/u/me"}',
      '{"type":"subagent/catalog","seq":1,"time":1001,"data":{"version":0,"childId":"c-small","mode":"continuable","label":"Helper"}}'
    ];
    const count = 40_000;
    for (let i = 0; i < count; i += 1) {
      lines.push(
        `{"type":"assistant/message","seq":${i + 2},"time":${2000 + i},"data":{"turn":1,"step":${i + 1},"message":{"role":"assistant","content":[{"type":"text","text":"x"}],"source":{"kind":"model","model":"m"}},"usage":{"inputTokens":1,"outputTokens":1,"totalTokens":2}}}`
      );
    }
    const childLog = [
      '{"type":"session","version":4,"id":"c-small","createdAt":1001,"cwd":"/u/me","parentSession":"p-big","origin":"subagent","isSeeded":false}',
      '{"type":"assistant/message","seq":1,"time":1500,"data":{"turn":1,"step":1,"message":{"role":"assistant","content":[{"type":"text","text":"y"}],"source":{"kind":"model","model":"m"}},"usage":{"inputTokens":1,"outputTokens":1,"totalTokens":2}}}'
    ].join("\n");
    const platform = createMemoryPlatform({
      files: { [parentPath]: encode(lines.join("\n")), [childPath]: encode(childLog) }
    });
    // 40,000 assistant/message records produce 80,000 events (request + assistant each) plus 2 child events = 80,002.
    const loaded = await adapter.load(platform, { agent: "dsh", path: parentPath });
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) {
      return;
    }
    expect(loaded.value.events).toHaveLength(count * 2 + 2);
    const summary = await adapter.summarize?.(platform, { agent: "dsh", path: parentPath });
    expect(summary?.ok).toBe(true);
    if (summary?.ok) {
      expect(summary.value.requests).toBe(count + 1);
      expect(summary.value.subagents).toBe(1);
    }
  }, 30_000);
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
