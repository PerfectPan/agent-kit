import { afterAll, describe, expect, it } from "vite-plus/test";
import {
  hookDialectConformance,
  probeRecipeConformance,
  sessionAdapterConformance,
  usageDecoderConformance
} from "@rivus/agent-kit-testing/public";
import { homeFromRule } from "@rivus/agent-kit-catalog/spi";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
// The kit joins with `/`, also onto a Windows temp root, so expected paths are joined the same way.
import { posix } from "node:path";
import { createNodePlatform } from "@rivus/agent-kit-platform-node/public";
import { foldTranscript, sessionRequestUsage } from "@rivus/agent-kit-sessions/public";
import { dim } from "../src/identity.js";
import { dimProbe } from "../src/discovery.js";
import { dimHookDialect } from "../src/hooks.js";
import { dimUsageDecoder } from "../src/usage.js";
import { dimSessionAdapter } from "../src/sessions.js";
import { dimSamples } from "./fixtures/hooks.js";

const ok = (stdout: string, stderr = "") => ({ code: 0, stdout, stderr });

const samples = {
  versions: [{ output: ok("dimcode 0.5.27\n"), version: { output: "dimcode 0.5.27", number: "0.5.27" } }]
};

// A synthetic database with two ledger rows, as the usage conformance fixture home holds.
const work = await mkdtemp(posix.join(tmpdir(), "agent-kit-dim-conformance-"));
afterAll(() => rm(work, { recursive: true, force: true }));
const node = createNodePlatform({ home: work, env: {} });
await mkdir(posix.join(work, "dimcode", "v2"), { recursive: true });
const database = posix.join(work, "dimcode", "v2", "dimcode.sqlite");
const db = node.sqlite!.open(database);
db.exec(
  "CREATE TABLE sessions (sessionId text primary key, cwd text not null default '', title text, status text not null, " +
    "tags text, heldBy text, heldAt text, createdAt text not null, updatedAt text not null, version integer not null)"
);
db.exec(
  "CREATE TABLE usage_ledger (ledgerId text primary key, sessionId text not null, runId text, " +
    "providerId text not null, modelId text not null, usage text not null, cost real, createdAt text not null)"
);
db.exec(
  "CREATE TABLE usage_run_stats (runId text primary key, sessionId text not null, providerId text not null, " +
    "modelId text not null, status text not null, startedAt text, endedAt text not null, durationMs integer)"
);
db.prepare("INSERT INTO sessions VALUES (?, ?, ?, ?, NULL, NULL, NULL, ?, ?, 1)").run(
  "s1",
  "/u/me/work",
  "Reply with exactly: PONG",
  "active",
  "2026-11-13T00:00:00.000Z",
  "2026-11-13T00:01:00.000Z"
);
db.exec(
  "CREATE TABLE messages (messageId text primary key, sessionId text not null, role text not null, parts text not null, " +
    "attachments text, toolMetadata text, metadata text, orderKey text not null, createdAt text not null, updatedAt text not null)"
);
db.prepare("INSERT INTO messages VALUES (?, ?, ?, ?, NULL, NULL, ?, ?, ?, ?)").run(
  "m1",
  "s1",
  "user",
  '[{"type":"text","text":"Reply with exactly: PONG"}]',
  "{}",
  "01a1d0991a54-0000",
  "2026-11-13T00:00:00.500Z",
  "2026-11-13T00:00:00.500Z"
);
db.prepare("INSERT INTO messages VALUES (?, ?, ?, ?, NULL, NULL, ?, ?, ?, ?)").run(
  "m2",
  "s1",
  "assistant",
  JSON.stringify([
    { type: "reasoning", text: "Check prompt", startTime: "2026-11-13T00:00:00.800Z" },
    { type: "text", text: "PONG", startTime: "2026-11-13T00:00:00.900Z", endTime: "2026-11-13T00:00:00.901Z" }
  ]),
  '{"runId":"run-1"}',
  "01a1d0991a96-0001",
  "2026-11-13T00:00:00.901Z",
  "2026-11-13T00:00:00.901Z"
);

const insertRunStat = db.prepare("INSERT INTO usage_run_stats VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
insertRunStat.run(
  "run-1",
  "s1",
  "zhipuai",
  "glm-4.6",
  "completed",
  "2026-11-13T00:00:00.000Z",
  "2026-11-13T00:00:00.901Z",
  901
);
insertRunStat.run(
  "run-2",
  "s1",
  "deepseek",
  "deepseek-chat",
  "completed",
  "2026-11-13T00:00:59.000Z",
  "2026-11-13T00:01:00.000Z",
  1000
);

const insert = db.prepare("INSERT INTO usage_ledger VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
insert.run(
  "l1",
  "s1",
  "run-1",
  "zhipuai",
  "glm-4.6",
  JSON.stringify({ promptTokens: 10, completionTokens: 4, totalTokens: 14 }),
  0.01,
  "2026-11-13T00:00:00.000Z"
);
insert.run(
  "l2",
  "s1",
  "run-2",
  "deepseek",
  "deepseek-chat",
  JSON.stringify({ promptTokens: 20, completionTokens: 6, totalTokens: 26, cacheReadTokens: 5 }),
  0.02,
  "2026-11-13T00:01:00.000Z"
);
db.close();

const usageFixtures = {
  platform: { fs: node.fs, sqlite: node.sqlite },
  home: homeFromRule("dim", dim.home, { home: work, env: { DIMCODE_HOME: posix.join(work, "dimcode") } }),
  sources: [{ path: database, records: 2 }]
};

const sessionRoot = posix.join(work, "dimcode", "v2");
const sessionChecks = sessionAdapterConformance(dimSessionAdapter, {
  platform: { fs: node.fs, sqlite: node.sqlite },
  root: sessionRoot,
  sessions: [
    {
      path: database,
      sessionId: "s1",
      records: 2,
      recordKeys: [`${database}\0${1}`, `${database}\0${2}`],
      capabilities: ["requests", "usage", "durations", "reasoning"]
    }
  ]
});

for (const [service, checks] of [
  ["hooks", hookDialectConformance(dimHookDialect, { samples: dimSamples }, { dim: dimHookDialect })],
  ["discovery", probeRecipeConformance(dimProbe, samples, { dim })],
  ["usage", usageDecoderConformance(dimUsageDecoder, usageFixtures)],
  ["sessions", sessionChecks]
] as const) {
  describe(`dim ${service} conformance`, () => {
    for (const { name, run } of checks) {
      it(`${name}`, async () => {
        await expect(run()).resolves.toBeUndefined();
      });
    }
  });
}

describe("dim session root and lastActiveAt", () => {
  it("returns the home directory from roots() and takes the latest write across sessions, messages, and usage_ledger", async () => {
    const home = homeFromRule("dim", dim.home, { home: work, env: { DIMCODE_HOME: posix.join(work, "dimcode") } });
    expect(dimSessionAdapter.roots(home)).toEqual([sessionRoot]);

    const isolated = await mkdtemp(posix.join(tmpdir(), "agent-kit-dim-last-active-"));
    try {
      const isolatedDbPath = posix.join(isolated, "dimcode.sqlite");
      const isolatedDb = node.sqlite!.open(isolatedDbPath);
      isolatedDb.exec(
        "CREATE TABLE sessions (sessionId text primary key, cwd text not null default '', title text, status text not null, " +
          "createdAt text not null, updatedAt text not null)"
      );
      isolatedDb.exec(
        "CREATE TABLE messages (messageId text primary key, sessionId text not null, role text not null, parts text not null, " +
          "metadata text, orderKey text not null, createdAt text not null, updatedAt text not null)"
      );
      isolatedDb.exec(
        "CREATE TABLE usage_ledger (ledgerId text primary key, sessionId text not null, runId text, " +
          "providerId text not null, modelId text not null, usage text not null, cost real, createdAt text not null)"
      );
      isolatedDb
        .prepare("INSERT INTO sessions VALUES (?, ?, ?, ?, ?, ?)")
        .run("s-msg", "/w", "Msg newer", "active", "2026-11-13T00:00:00.000Z", "2026-11-13T00:01:00.000Z");
      isolatedDb
        .prepare("INSERT INTO messages VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
        .run(
          "m-new",
          "s-msg",
          "assistant",
          '[{"type":"text","text":"hi"}]',
          "{}",
          "0001",
          "2026-11-13T00:02:00.000Z",
          "2026-11-13T00:03:00.000Z"
        );
      isolatedDb
        .prepare("INSERT INTO sessions VALUES (?, ?, ?, ?, ?, ?)")
        .run("s-ledger", "/w", "Ledger newer", "active", "2026-11-13T00:00:00.000Z", "2026-11-13T00:01:00.000Z");
      isolatedDb
        .prepare("INSERT INTO usage_ledger VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
        .run(
          "l-new",
          "s-ledger",
          "run-1",
          "deepseek",
          "deepseek-chat",
          JSON.stringify({ promptTokens: 5, completionTokens: 5, totalTokens: 10 }),
          0.01,
          "2026-11-13T00:05:00.000Z"
        );
      isolatedDb.close();

      const heads = [];
      for await (const item of dimSessionAdapter.discover({ fs: node.fs, sqlite: node.sqlite }, isolated)) {
        if (!("error" in item)) {
          heads.push(item);
        }
      }
      expect(heads.find((h) => h.ref.sessionId === "s-msg")?.lastActiveAt).toBe(Date.parse("2026-11-13T00:03:00.000Z"));
      expect(heads.find((h) => h.ref.sessionId === "s-ledger")?.lastActiveAt).toBe(
        Date.parse("2026-11-13T00:05:00.000Z")
      );
    } finally {
      await rm(isolated, { recursive: true, force: true });
    }
  });

  it("deduplicates usage_run_stats durationMs per runId, ignores negative values, and tolerates missing usage_run_stats", async () => {
    const isolated = await mkdtemp(posix.join(tmpdir(), "agent-kit-dim-durations-"));
    try {
      const dbPath = posix.join(isolated, "dimcode.sqlite");
      const isolatedDb = node.sqlite!.open(dbPath);
      isolatedDb.exec(
        "CREATE TABLE sessions (sessionId text primary key, cwd text not null default '', title text, status text not null, " +
          "createdAt text not null, updatedAt text not null)"
      );
      isolatedDb.exec(
        "CREATE TABLE messages (messageId text primary key, sessionId text not null, role text not null, parts text not null, " +
          "metadata text, orderKey text not null, createdAt text not null, updatedAt text not null)"
      );
      isolatedDb.exec(
        "CREATE TABLE usage_ledger (ledgerId text primary key, sessionId text not null, runId text, " +
          "providerId text not null, modelId text not null, usage text not null, cost real, createdAt text not null)"
      );
      isolatedDb.exec(
        "CREATE TABLE usage_run_stats (runId text primary key, sessionId text not null, durationMs integer)"
      );
      isolatedDb
        .prepare("INSERT INTO sessions VALUES (?, ?, ?, ?, ?, ?)")
        .run("s-dup", "/w", "Dup runs", "active", "2026-11-13T00:00:00.000Z", "2026-11-13T00:01:00.000Z");
      isolatedDb.prepare("INSERT INTO usage_run_stats VALUES (?, ?, ?)").run("run-dup", "s-dup", 500);
      isolatedDb.prepare("INSERT INTO usage_run_stats VALUES (?, ?, ?)").run("run-neg", "s-dup", -10);
      const ins = isolatedDb.prepare("INSERT INTO usage_ledger VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
      ins.run(
        "l1",
        "s-dup",
        "run-dup",
        "p",
        "m",
        JSON.stringify({ promptTokens: 5, completionTokens: 2 }),
        0,
        "2026-11-13T00:00:01.000Z"
      );
      ins.run(
        "l2",
        "s-dup",
        "run-dup",
        "p",
        "m",
        JSON.stringify({ promptTokens: 3, completionTokens: 1 }),
        0,
        "2026-11-13T00:00:02.000Z"
      );
      ins.run(
        "l3",
        "s-dup",
        "run-neg",
        "p",
        "m",
        JSON.stringify({ promptTokens: 4, completionTokens: 1 }),
        0,
        "2026-11-13T00:00:03.000Z"
      );
      isolatedDb.close();

      const p = { fs: node.fs, sqlite: node.sqlite };
      const ref = { agent: "dim" as const, path: dbPath, sessionId: "s-dup" };
      const loaded = await dimSessionAdapter.load(p, ref);
      const summary = await dimSessionAdapter.summarize!(p, ref);
      expect(loaded.ok).toBe(true);
      expect(summary.ok).toBe(true);
      if (loaded.ok && summary.ok) {
        expect(loaded.value.capabilities).toEqual(["requests", "usage", "durations"]);
        expect(summary.value.durationMs).toBe(500);
        expect(summary.value).toStrictEqual({
          ...foldTranscript(loaded.value),
          requestUsage: sessionRequestUsage(loaded.value)
        });
      }

      // Drop usage_run_stats to verify older schemas keep working without durations.
      const legacyDb = node.sqlite!.open(dbPath);
      legacyDb.exec("DROP TABLE usage_run_stats");
      legacyDb.close();
      const legacyLoaded = await dimSessionAdapter.load(p, ref);
      const legacySummary = await dimSessionAdapter.summarize!(p, ref);
      expect(legacyLoaded.ok).toBe(true);
      expect(legacySummary.ok).toBe(true);
      if (legacyLoaded.ok && legacySummary.ok) {
        expect(legacyLoaded.value.capabilities).toEqual(["requests", "usage"]);
        expect(legacySummary.value.durationMs).toBeUndefined();
        expect(legacySummary.value).toStrictEqual({
          ...foldTranscript(legacyLoaded.value),
          requestUsage: sessionRequestUsage(legacyLoaded.value)
        });
      }
    } finally {
      await rm(isolated, { recursive: true, force: true });
    }
  });
});
