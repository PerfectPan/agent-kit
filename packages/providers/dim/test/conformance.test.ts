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
import { dimTopLevelSessions } from "../src/sessions/subagents.js";
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
db.exec(
  "CREATE TABLE compaction_states (sessionId text primary key, summary text, cursor text, checkpoints text not null, " +
    "updatedAt text not null)"
);
db.exec(
  "CREATE TABLE session_relations (relationId text primary key, sourceSessionId text not null, " +
    "targetSessionId text not null, relationType text not null, typeData text, createdAt text not null)"
);
db.prepare("INSERT INTO sessions VALUES (?, ?, ?, ?, NULL, NULL, NULL, ?, ?, 1)").run(
  "s1",
  "/u/me/work",
  "Reply with exactly: PONG",
  "active",
  "2026-11-13T00:00:00.000Z",
  "2026-11-13T00:01:00.000Z"
);
db.prepare("INSERT INTO sessions VALUES (?, ?, ?, ?, NULL, NULL, NULL, ?, ?, 1)").run(
  "s1-sub",
  "/u/me/work",
  "Subagent explorer",
  "completed",
  "2026-11-13T00:00:01.000Z",
  "2026-11-13T00:00:05.000Z"
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
    { type: "thinking", thinking: "Check prompt", startTime: "2026-11-13T00:00:00.800Z" },
    {
      type: "tool_use",
      id: "call-sub-1",
      name: "agent",
      input: { subagent_type: "explorer", prompt: "Inspect files" },
      startTime: "2026-11-13T00:00:00.850Z"
    },
    { type: "text", text: "PONG", startTime: "2026-11-13T00:00:00.900Z", endTime: "2026-11-13T00:00:00.901Z" }
  ]),
  '{"runId":"run-1"}',
  "01a1d0991a96-0001",
  "2026-11-13T00:00:00.901Z",
  "2026-11-13T00:00:00.901Z"
);
db.prepare("INSERT INTO messages VALUES (?, ?, ?, ?, NULL, NULL, ?, ?, ?, ?)").run(
  "m3",
  "s1",
  "tool_result",
  JSON.stringify([{ type: "tool_result", tool_use_id: "call-sub-1", content: "Found 2 files", is_error: false }]),
  '{"runId":"run-1"}',
  "01a1d0991a97-0002",
  "2026-11-13T00:00:05.100Z",
  "2026-11-13T00:00:05.100Z"
);
db.prepare("INSERT INTO messages VALUES (?, ?, ?, ?, NULL, NULL, ?, ?, ?, ?)").run(
  "m-sub-1",
  "s1-sub",
  "user",
  '[{"type":"text","text":"Inspect files"}]',
  "{}",
  "01a1d0991a96-0001",
  "2026-11-13T00:00:01.000Z",
  "2026-11-13T00:00:01.000Z"
);
db.prepare("INSERT INTO messages VALUES (?, ?, ?, ?, NULL, NULL, ?, ?, ?, ?)").run(
  "m-sub-2",
  "s1-sub",
  "assistant",
  '[{"type":"text","text":"Found 2 files"}]',
  '{"runId":"run-sub-1"}',
  "01a1d0991a96-0002",
  "2026-11-13T00:00:04.000Z",
  "2026-11-13T00:00:04.000Z"
);
db.prepare("INSERT INTO compaction_states VALUES (?, ?, ?, ?, ?)").run(
  "s1",
  "Summarized prior exchange",
  "m2",
  JSON.stringify([
    {
      messageId: "m2",
      createdAt: "2026-11-13T00:00:02.000Z",
      reason: "auto",
      summarySnapshot: "Summarized prior exchange",
      diagnostics: { estimatedInputTokens: 1200, estimatedPostCompactionTokens: 320 }
    }
  ]),
  "2026-11-13T00:00:02.000Z"
);
db.prepare("INSERT INTO session_relations VALUES (?, ?, ?, ?, ?, ?)").run(
  "rel-1",
  "s1",
  "s1-sub",
  "subagent",
  JSON.stringify({ parentToolCallId: "call-sub-1", subagentType: "explorer" }),
  "2026-11-13T00:00:01.000Z"
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
      records: 8,
      recordKeys: [
        `${database}\0${1}`,
        `${database}\0${2}`,
        `${database}\0${3}`,
        `${database}\0${4}`,
        `${database}\0${5}`
      ],
      capabilities: ["requests", "usage", "durations", "reasoning", "compaction", "compactionTokens", "subagents"]
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

  it("handles compaction shadowing, unavailable/nested/cyclic subagents, and keeps branch relations top-level", async () => {
    // Pure cycle and orphan-source handling in dimTopLevelSessions.
    expect([
      ...dimTopLevelSessions(
        ["root", "child", "orphan", "cyc-b", "cyc-a"],
        [
          { sourceSessionId: "root", targetSessionId: "child", createdAt: 1 },
          { sourceSessionId: "missing", targetSessionId: "orphan", createdAt: 2 },
          { sourceSessionId: "cyc-a", targetSessionId: "cyc-b", createdAt: 3 },
          { sourceSessionId: "cyc-b", targetSessionId: "cyc-a", createdAt: 4 }
        ]
      )
    ]).toEqual(["root", "orphan", "cyc-a"]);

    const isolated = await mkdtemp(posix.join(tmpdir(), "agent-kit-dim-subagents-"));
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
        "CREATE TABLE compaction_states (sessionId text primary key, checkpoints text not null, updatedAt text not null)"
      );
      isolatedDb.exec(
        "CREATE TABLE session_relations (relationId text primary key, sourceSessionId text not null, " +
          "targetSessionId text not null, relationType text not null, typeData text, createdAt text not null)"
      );

      const insSession = isolatedDb.prepare("INSERT INTO sessions VALUES (?, ?, ?, ?, ?, ?)");
      insSession.run("root", "/w", "Root", "active", "2026-11-13T00:00:00.000Z", "2026-11-13T00:02:00.000Z");
      insSession.run("sub-a", "/w", "Sub A", "completed", "2026-11-13T00:00:10.000Z", "2026-11-13T00:00:20.000Z");
      insSession.run("sub-b", "/w", "Sub B", "completed", "2026-11-13T00:00:12.000Z", "2026-11-13T00:00:18.000Z");
      insSession.run("fork-1", "/w", "Fork", "active", "2026-11-13T00:01:00.000Z", "2026-11-13T00:01:10.000Z");

      const insMsg = isolatedDb.prepare("INSERT INTO messages VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
      insMsg.run(
        "m1",
        "root",
        "user",
        '[{"type":"text","text":"Start"}]',
        "{}",
        "0001",
        "2026-11-13T00:00:01.000Z",
        "2026-11-13T00:00:01.000Z"
      );
      insMsg.run(
        "m2",
        "root",
        "assistant",
        JSON.stringify([{ type: "tool_use", id: "c1", name: "agent", input: {} }]),
        "{}",
        "0002",
        "2026-11-13T00:00:05.000Z",
        "2026-11-13T00:00:05.000Z"
      );
      insMsg.run(
        "m3",
        "root",
        "user",
        '[{"type":"text","text":"After compact"}]',
        "{}",
        "0003",
        "2026-11-13T00:00:30.000Z",
        "2026-11-13T00:00:30.000Z"
      );
      insMsg.run(
        "ms1",
        "sub-a",
        "assistant",
        JSON.stringify([{ type: "tool_use", id: "c2", name: "agent", input: {} }]),
        "{}",
        "0001",
        "2026-11-13T00:00:11.000Z",
        "2026-11-13T00:00:11.000Z"
      );
      insMsg.run(
        "ms2",
        "sub-b",
        "user",
        '[{"type":"text","text":"Nested user should not count as root turn"}]',
        "{}",
        "0001",
        "2026-11-13T00:00:13.000Z",
        "2026-11-13T00:00:13.000Z"
      );

      // Compaction with missing cursor falls back by timestamp (after m2, before m3) and ignores negative tokens.
      isolatedDb.prepare("INSERT INTO compaction_states VALUES (?, ?, ?)").run(
        "root",
        JSON.stringify([
          {
            messageId: "missing-msg",
            createdAt: "2026-11-13T00:00:20.000Z",
            reason: "manual",
            summarySnapshot: "Compact summary",
            diagnostics: { estimatedInputTokens: -5, estimatedPostCompactionTokens: -1 }
          }
        ]),
        "2026-11-13T00:00:20.000Z"
      );

      const insRel = isolatedDb.prepare("INSERT INTO session_relations VALUES (?, ?, ?, ?, ?, ?)");
      insRel.run(
        "r1",
        "root",
        "sub-a",
        "subagent",
        JSON.stringify({ parentToolCallId: "c1", subagentType: "worker" }),
        "2026-11-13T00:00:10.000Z"
      );
      insRel.run(
        "r2",
        "root",
        "sub-gone",
        "subagent",
        JSON.stringify({ subagentType: "ghost" }),
        "2026-11-13T00:00:11.000Z"
      );
      insRel.run(
        "r3",
        "sub-a",
        "sub-b",
        "subagent",
        JSON.stringify({ parentToolCallId: "c2", subagentType: "nested" }),
        "2026-11-13T00:00:12.000Z"
      );
      // Cycle back to root must not loop.
      insRel.run("r4", "sub-b", "root", "subagent", "{}", "2026-11-13T00:00:14.000Z");
      // Missing intermediate subagent `sub-gone` pointing to an existing grandchild: both load and summarize must stop at `sub-gone`.
      insSession.run(
        "sub-orphan-grand",
        "/w",
        "Grandchild of missing",
        "completed",
        "2026-11-13T00:00:15.000Z",
        "2026-11-13T00:00:16.000Z"
      );
      isolatedDb
        .prepare("INSERT INTO usage_ledger VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
        .run(
          "l-grand",
          "sub-orphan-grand",
          "run-grand",
          "p",
          "m",
          JSON.stringify({ promptTokens: 999, completionTokens: 1 }),
          0.5,
          "2026-11-13T00:00:16.000Z"
        );
      insRel.run("r-missing-grand", "sub-gone", "sub-orphan-grand", "subagent", "{}", "2026-11-13T00:00:15.000Z");

      // Branch relation is a user fork, not a subagent.
      insRel.run("r5", "root", "fork-1", "branch", "{}", "2026-11-13T00:01:00.000Z");
      isolatedDb.close();

      const p = { fs: node.fs, sqlite: node.sqlite };
      const discovered: string[] = [];
      for await (const item of dimSessionAdapter.discover(p, isolated)) {
        if (!("error" in item) && item.ref.sessionId !== undefined) {
          discovered.push(item.ref.sessionId);
        }
      }
      expect(discovered.sort()).toEqual(["fork-1", "root", "sub-orphan-grand"]);

      const ref = { agent: "dim" as const, path: dbPath, sessionId: "root" };
      const loaded = await dimSessionAdapter.load(p, ref);
      const summary = await dimSessionAdapter.summarize!(p, ref, { prompts: { limit: 5, maxChars: 100 } });
      expect(loaded.ok).toBe(true);
      expect(summary.ok).toBe(true);
      if (loaded.ok && summary.ok) {
        expect(loaded.value.capabilities).toEqual(["compaction", "subagents"]);
        expect(loaded.value.agents).toEqual([
          { id: "dim" },
          { id: "sub-a", parentId: "dim", spawnEventId: "2:0", title: "worker" },
          { id: "sub-gone", parentId: "dim", title: "ghost", unavailable: true },
          { id: "sub-b", parentId: "sub-a", spawnEventId: "4:0", title: "nested" }
        ]);
        const compaction = loaded.value.events.find((e) => e.kind === "compaction");
        expect(compaction).toBeDefined();
        const m1 = loaded.value.events.find((e) => e.id === "1:0");
        const m3 = loaded.value.events.find((e) => e.id === "3:0");
        expect(m1?.shadowedBy).toBe(compaction?.id);
        expect(m3?.shadowedBy).toBeUndefined();
        expect(summary.value.turns).toBe(2);
        expect(summary.value.compactions).toBe(1);
        expect(summary.value.subagents).toBe(3);
        expect(summary.value.prompts).toEqual([{ text: "Start" }, { text: "After compact" }]);
        const { prompts: _prompts, ...withoutPrompts } = summary.value;
        expect(withoutPrompts).toStrictEqual({
          ...foldTranscript(loaded.value),
          requestUsage: sessionRequestUsage(loaded.value)
        });
      }
    } finally {
      await rm(isolated, { recursive: true, force: true });
    }
  });

  it("excludes inherited parent history from forkContext: 'all' subagent lanes in both load and summarize", async () => {
    const isolated = await mkdtemp(posix.join(tmpdir(), "agent-kit-dim-fork-subagent-"));
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
        "CREATE TABLE compaction_states (sessionId text primary key, checkpoints text not null, updatedAt text not null)"
      );
      isolatedDb.exec(
        "CREATE TABLE session_relations (relationId text primary key, sourceSessionId text not null, " +
          "targetSessionId text not null, relationType text not null, typeData text, createdAt text not null)"
      );

      const insSession = isolatedDb.prepare("INSERT INTO sessions VALUES (?, ?, ?, ?, ?, ?)");
      insSession.run("parent", "/w", "Parent", "active", "2026-11-13T00:00:00.000Z", "2026-11-13T00:02:00.000Z");
      insSession.run(
        "fork-sub",
        "/w",
        "Forked Sub",
        "completed",
        "2026-11-13T00:01:00.000Z",
        "2026-11-13T00:01:30.000Z"
      );

      const insMsg = isolatedDb.prepare("INSERT INTO messages VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
      insMsg.run(
        "p-m1",
        "parent",
        "user",
        '[{"type":"text","text":"Parent prompt"}]',
        "{}",
        "0001",
        "2026-11-13T00:00:01.000Z",
        "2026-11-13T00:00:01.000Z"
      );
      // Cloned message in forked subagent (msg_fork_* and parent createdAt) plus one new subagent message.
      insMsg.run(
        "msg_fork_1",
        "fork-sub",
        "user",
        '[{"type":"text","text":"Parent prompt"}]',
        "{}",
        "0001",
        "2026-11-13T00:00:01.000Z",
        "2026-11-13T00:01:00.000Z"
      );
      insMsg.run(
        "c-m1",
        "fork-sub",
        "assistant",
        '[{"type":"text","text":"Child reply"}]',
        '{"runId":"run-child"}',
        "0002",
        "2026-11-13T00:01:10.000Z",
        "2026-11-13T00:01:10.000Z"
      );

      // Cloned compaction checkpoint remapped to msg_fork_1 must not be counted twice.
      const insCompact = isolatedDb.prepare("INSERT INTO compaction_states VALUES (?, ?, ?)");
      insCompact.run(
        "parent",
        JSON.stringify([{ messageId: "p-m1", createdAt: "2026-11-13T00:00:30.000Z", reason: "auto" }]),
        "2026-11-13T00:00:30.000Z"
      );
      insCompact.run(
        "fork-sub",
        JSON.stringify([{ messageId: "msg_fork_1", createdAt: "2026-11-13T00:00:30.000Z", reason: "auto" }]),
        "2026-11-13T00:01:00.000Z"
      );

      // Parent ledger (100 input tokens), cloned into fork-sub (same runId/createdAt), plus child's own 5 input tokens.
      const insLedger = isolatedDb.prepare("INSERT INTO usage_ledger VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
      insLedger.run(
        "l-parent",
        "parent",
        "run-parent",
        "p",
        "m",
        JSON.stringify({ promptTokens: 100, completionTokens: 10 }),
        0.1,
        "2026-11-13T00:00:10.000Z"
      );
      insLedger.run(
        "l-cloned",
        "fork-sub",
        "run-parent",
        "p",
        "m",
        JSON.stringify({ promptTokens: 100, completionTokens: 10 }),
        0.1,
        "2026-11-13T00:00:10.000Z"
      );
      insLedger.run(
        "l-child",
        "fork-sub",
        "run-child",
        "p",
        "m",
        JSON.stringify({ promptTokens: 5, completionTokens: 2 }),
        0.005,
        "2026-11-13T00:01:10.000Z"
      );

      isolatedDb
        .prepare("INSERT INTO session_relations VALUES (?, ?, ?, ?, ?, ?)")
        .run(
          "r-fork",
          "parent",
          "fork-sub",
          "subagent",
          JSON.stringify({ subagentType: "forked", forkContext: "all" }),
          "2026-11-13T00:01:00.000Z"
        );
      isolatedDb.close();

      const p = { fs: node.fs, sqlite: node.sqlite };
      const ref = { agent: "dim" as const, path: dbPath, sessionId: "parent" };
      const loaded = await dimSessionAdapter.load(p, ref);
      const summary = await dimSessionAdapter.summarize!(p, ref);
      expect(loaded.ok).toBe(true);
      expect(summary.ok).toBe(true);
      if (loaded.ok && summary.ok) {
        const folded = foldTranscript(loaded.value);
        expect(folded.requests).toBe(2);
        expect(folded.inputTokens).toBe(105);
        expect(folded.outputTokens).toBe(12);
        expect(folded.compactions).toBe(1);
        expect(folded.subagents).toBe(1);
        expect(summary.value).toStrictEqual({
          ...folded,
          requestUsage: sessionRequestUsage(loaded.value)
        });
      }
    } finally {
      await rm(isolated, { recursive: true, force: true });
    }
  });
});
