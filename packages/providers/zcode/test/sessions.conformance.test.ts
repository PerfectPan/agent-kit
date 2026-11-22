import { mkdirSync } from "node:fs";
import { copyFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { afterAll, describe, expect, it } from "vite-plus/test";

import { createNodePlatform } from "@rivus/agent-kit-platform-node/public";
import { foldTranscript, sessionPrompts, type SessionPlatform } from "@rivus/agent-kit-sessions/public";
import { sessionAdapterConformance, type ConformanceSession } from "@rivus/agent-kit-testing/public";
import { zcodeSessionAdapter } from "../src/sessions.js";

const tempRoot = await mkdtemp(join(tmpdir(), "agent-kit-zcode-"));
afterAll(() => rm(tempRoot, { recursive: true, force: true }));

// The real layout: the database lives at `<home>/cli/db/db.sqlite`.
const dbPath = join(tempRoot, "cli", "db", "db.sqlite");

function createDatabase(): { sessions: ConformanceSession[]; ghostPartRowid: number } {
  mkdirSync(join(tempRoot, "cli", "db"), { recursive: true });
  const db = new DatabaseSync(dbPath);
  // The columns the adapter selects, with the real schema's shape: soft deletion through `time_deleted` and the
  // app's per-session `sequence` order.
  db.exec(`
    create table session (
      rowid integer primary key,
      id text not null,
      title text not null,
      directory text not null,
      time_created integer not null,
      time_updated integer not null,
      version text not null,
      time_deleted integer
    );
    create table message (
      rowid integer primary key,
      id text not null,
      session_id text not null,
      time_created integer not null,
      data text not null,
      sequence integer
    );
    create table part (
      rowid integer primary key,
      id text not null,
      message_id text not null,
      session_id text not null,
      time_created integer not null,
      data text not null,
      sequence integer
    );
    create table session_entry (
      rowid integer primary key,
      id text not null,
      session_id text not null,
      type text not null,
      time_created integer not null,
      data text not null
    );
  `);
  const session = db.prepare(
    "insert into session (id, title, directory, time_created, time_updated, version, time_deleted) values (?, ?, ?, ?, ?, ?, ?)"
  );
  const message = db.prepare(
    "insert into message (id, session_id, time_created, data, sequence) values (?, ?, ?, ?, ?)"
  );
  const part = db.prepare(
    "insert into part (id, message_id, session_id, time_created, data, sequence) values (?, ?, ?, ?, ?, ?)"
  );
  const entry = db.prepare(
    "insert into session_entry (id, session_id, type, time_created, data) values (?, ?, ?, ?, ?)"
  );
  const promptSnapshotData = (system: unknown): string =>
    JSON.stringify({
      model: { providerId: "test", modelId: "test-model" },
      ...(system === undefined ? {} : { system })
    });

  session.run("ses_plain", "Plain session", "/u/me/work", 1000, 3000, "3.17.2", null);
  message.run("msg_u1", "ses_plain", 1000, JSON.stringify({ role: "user", time: { created: 1000 } }), 0);
  part.run("prt_t1", "msg_u1", "ses_plain", 1000, JSON.stringify({ type: "text", text: "hello" }), 0);
  message.run(
    "msg_a1",
    "ses_plain",
    2000,
    JSON.stringify({
      role: "assistant",
      tokens: { input: 10, output: 5, reasoning: 2, total: 15, cache: { read: 0, write: 0 } },
      modelId: "test-model",
      providerId: "test",
      finish: "tool-calls",
      time: { created: 2000, completed: 3000 }
    }),
    1
  );
  part.run("prt_r1", "msg_a1", "ses_plain", 2100, JSON.stringify({ type: "reasoning", text: "think" }), 0);
  part.run("prt_x1", "msg_a1", "ses_plain", 2200, JSON.stringify({ type: "text", text: "hi" }), 1);
  part.run(
    "prt_c1",
    "msg_a1",
    "ses_plain",
    2300,
    JSON.stringify({
      type: "tool",
      tool: "read",
      callID: "call-1",
      state: { status: "completed", input: { path: "/a" }, output: "ok" }
    }),
    2
  );
  part.run("prt_s1", "msg_a1", "ses_plain", 2400, JSON.stringify({ type: "step-start" }), 3);
  // A part whose message row does not exist: the loader counts it as skipped instead of dropping it.
  const ghost = part.run("prt_o1", "msg_ghost", "ses_plain", 2500, JSON.stringify({ type: "text", text: "ghost" }), 0);
  const ghostPartRowid = Number(ghost.lastInsertRowid);

  session.run("ses_unknown", "Unknown part", "/u/me/work", 4000, 5000, "3.17.2", null);
  message.run("msg_u2", "ses_unknown", 4000, JSON.stringify({ role: "user", time: { created: 4000 } }), 0);
  part.run("prt_t2", "msg_u2", "ses_unknown", 4000, JSON.stringify({ type: "text", text: "again" }), 0);
  message.run(
    "msg_a2",
    "ses_unknown",
    5000,
    JSON.stringify({
      role: "assistant",
      tokens: { input: 1, output: 1, total: 2, cache: { read: 0, write: 0 } },
      modelID: "test-model",
      providerID: "test",
      finish: "stop",
      time: { created: 5000, completed: 5100 }
    }),
    1
  );
  part.run("prt_z1", "msg_a2", "ses_unknown", 5100, JSON.stringify({ type: "mystery" }), 0);

  // The app's `sequence` orders messages, not `time_created`: the reply was stored with an earlier clock.
  session.run("ses_order", "Sequence order", "/u/me/work", 8000, 9000, "3.17.2", null);
  message.run("msg_u4", "ses_order", 9000, JSON.stringify({ role: "user", time: { created: 9000 } }), 0);
  part.run("prt_t4", "msg_u4", "ses_order", 9000, JSON.stringify({ type: "text", text: "first" }), 0);
  message.run(
    "msg_a4",
    "ses_order",
    8000,
    JSON.stringify({ role: "assistant", modelId: "test-model", finish: "stop", time: { created: 8000 } }),
    1
  );
  part.run("prt_x4", "msg_a4", "ses_order", 8000, JSON.stringify({ type: "text", text: "second" }), 0);

  // A soft-deleted session stays undiscovered, undetectable and unloadable.
  session.run("ses_deleted", "Deleted session", "/u/me/work", 6000, 7000, "3.17.2", 7000);
  message.run("msg_u3", "ses_deleted", 6000, JSON.stringify({ role: "user", time: { created: 6000 } }), 0);
  part.run("prt_t3", "msg_u3", "ses_deleted", 6000, JSON.stringify({ type: "text", text: "gone" }), 0);
  db.exec("ALTER TABLE session ADD COLUMN parent_id TEXT");
  db.exec("ALTER TABLE session ADD COLUMN task_type TEXT");
  db.prepare(
    "INSERT INTO session (id, parent_id, task_type, title, directory, time_created, time_updated, version) VALUES ('ses_fork', 'ses_plain', 'fork', 'Manual fork', '', 4000, 4000, '')"
  ).run();
  db.exec(`
    INSERT INTO message (id, session_id, time_created, data, sequence)
      SELECT 'fork_' || id, 'ses_fork', time_created, data, sequence FROM message WHERE session_id = 'ses_plain';
    INSERT INTO part (id, message_id, session_id, time_created, data, sequence)
      SELECT 'fork_' || id, 'fork_' || message_id, 'ses_fork', time_created, data, sequence FROM part WHERE session_id = 'ses_plain';
  `);
  db.prepare(
    "INSERT INTO session (id, parent_id, title, directory, time_created, time_updated, version) VALUES (?, ?, '', '', 10000, 10000, '')"
  ).run("ses_features", null);
  db.prepare(
    "INSERT INTO session (id, parent_id, title, directory, time_created, time_updated, version) VALUES (?, ?, '', '', 10000, 10000, '')"
  ).run("ses_child", "ses_features");
  db.prepare("INSERT INTO message (id, session_id, time_created, data) VALUES (?, ?, ?, ?)").run(
    "msg_features",
    "ses_features",
    10000,
    JSON.stringify({ role: "user" })
  );
  // The shared SQLite capability set also accepts explicit boundary token metadata.
  db.prepare("INSERT INTO part (id, message_id, session_id, time_created, data) VALUES (?, ?, ?, ?, ?)").run(
    "part_features",
    "msg_features",
    "ses_features",
    10000,
    JSON.stringify({ type: "compaction", auto: true, preCompactTokenCount: 100 })
  );
  // A child lane's own prompt snapshot becomes that lane's `systemPrompt`.
  entry.run(
    "ent_child",
    "ses_child",
    "runtime/prompt_snapshot",
    10500,
    promptSnapshotData([{ role: "system", content: "Child prompt" }])
  );

  // The latest readable snapshot is the session's; an entry without system text and an unreadable one are skipped.
  session.run("ses_snapshot", "Prompt snapshots", "/u/me/work", 11000, 16000, "3.17.2", null);
  entry.run(
    "ent_a",
    "ses_snapshot",
    "runtime/prompt_snapshot",
    11000,
    promptSnapshotData([{ role: "system", content: "First prompt" }])
  );
  entry.run(
    "ent_b",
    "ses_snapshot",
    "runtime/prompt_snapshot",
    12000,
    promptSnapshotData([{ role: "system", content: "Second prompt" }])
  );
  entry.run("ent_c", "ses_snapshot", "runtime/prompt_snapshot", 13000, promptSnapshotData([]));
  entry.run("ent_d", "ses_snapshot", "runtime/prompt_snapshot", 14000, "{broken");
  message.run("msg_snap", "ses_snapshot", 15000, JSON.stringify({ role: "user", time: { created: 15000 } }), 0);
  part.run("prt_snap", "msg_snap", "ses_snapshot", 15000, JSON.stringify({ type: "text", text: "hello" }), 0);
  db.close();

  const rows = new DatabaseSync(dbPath, { readOnly: true });
  const keysFor = (sessionId: string): string[] => {
    const out: string[] = [`${dbPath}\0${1}`];
    let line = 2;
    // Prompt snapshot entries are walked first, in their `time_created, id` order.
    const entries = rows
      .prepare(
        "select id from session_entry where session_id = ? and type = 'runtime/prompt_snapshot' order by time_created, id"
      )
      .all(sessionId);
    for (const _snapshot of entries) {
      out.push(`${dbPath}\0${line++}`);
    }
    const messages = rows
      .prepare("select id from message where session_id = ? order by sequence, time_created, id")
      .all(sessionId);
    for (const message of messages) {
      out.push(`${dbPath}\0${line++}`);
      const parts = rows
        .prepare("select id from part where message_id = ? order by time_created, id")
        .all(String(message.id));
      for (let index = 0; index < parts.length; index++) {
        out.push(`${dbPath}\0${line++}`);
      }
    }
    // Parts no message row owns: the loader counts them as skipped after the messages, in part order.
    const orphaned = rows
      .prepare(
        "select id from part where session_id = ? and message_id not in (select id from message where session_id = ?) order by time_created, id"
      )
      .all(sessionId, sessionId);
    for (let index = 0; index < orphaned.length; index++) {
      out.push(`${dbPath}\0${line++}`);
    }
    return out;
  };
  const sessions: ConformanceSession[] = [
    {
      path: dbPath,
      sessionId: "ses_fork",
      records: 9,
      recordKeys: keysFor("ses_fork"),
      capabilities: ["requests", "usage", "durations", "reasoning"]
    },
    {
      path: dbPath,
      sessionId: "ses_features",
      records: 5,
      recordKeys: [1, 2, 3, 4, 5].map((line) => `${dbPath}\0${line}`),
      capabilities: ["compaction", "compactionTokens", "subagents", "systemPrompt"],
      compactionShadowing: false
    },
    {
      path: dbPath,
      sessionId: "ses_plain",
      records: 9,
      recordKeys: keysFor("ses_plain"),
      capabilities: ["requests", "usage", "durations", "reasoning"]
    },
    {
      path: dbPath,
      sessionId: "ses_unknown",
      records: 5,
      recordKeys: keysFor("ses_unknown"),
      capabilities: ["requests", "usage", "durations"]
    },
    {
      path: dbPath,
      sessionId: "ses_order",
      records: 4,
      recordKeys: keysFor("ses_order"),
      capabilities: ["requests"]
    },
    {
      path: dbPath,
      sessionId: "ses_snapshot",
      records: 7,
      recordKeys: keysFor("ses_snapshot"),
      capabilities: ["systemPrompt"]
    }
  ];
  rows.close();
  return { sessions, ghostPartRowid };
}

const { sessions, ghostPartRowid } = createDatabase();

describe("zcode conformance (sqlite)", () => {
  const platform = createNodePlatform({ home: tempRoot });
  const checks = sessionAdapterConformance(zcodeSessionAdapter, {
    platform,
    root: tempRoot,
    sessions
  });
  for (const { name, run } of checks) {
    it(`${name}`, async () => {
      await expect(run()).resolves.toBeUndefined();
    });
  }
});

describe("zcode adapter", () => {
  const platform = createNodePlatform({ home: tempRoot });

  it("keeps a manual fork visible and excludes its copied requests from the parent", async () => {
    const ids = [];
    for await (const item of zcodeSessionAdapter.discover(platform, tempRoot)) {
      ids.push(item.ref.sessionId);
    }
    expect(ids).toContain("ses_fork");
    for (const sessionId of ["ses_plain", "ses_fork"]) {
      const ref = { agent: "zcode", path: dbPath, sessionId };
      const loaded = await zcodeSessionAdapter.load(platform, ref);
      expect(loaded.ok).toBe(true);
      if (!loaded.ok) {
        return;
      }
      expect(loaded.value.agents).toEqual([{ id: "main" }]);
      expect(foldTranscript(loaded.value)).toMatchObject({
        requests: 1,
        inputTokens: 10,
        outputTokens: 5,
        durationMs: 1000
      });
      expect(await zcodeSessionAdapter.summarize!(platform, ref)).toEqual({
        ok: true,
        value: foldTranscript(loaded.value)
      });
    }
  });

  it.each([false, true])(
    "deduplicates real timeline/boundary shapes and merges live child lanes (boundary first: %s)",
    async (boundaryFirst) => {
      const treePath = join(tempRoot, `tree-${boundaryFirst}.sqlite`);
      await copyFile(dbPath, treePath);
      const db = new DatabaseSync(treePath);
      const session = db.prepare(
        "INSERT INTO session (id, parent_id, title, directory, time_created, time_updated, version, time_deleted) VALUES (?, ?, ?, '', 1, 6000, '', ?)"
      );
      session.run("child", "ses_plain", "Investigate", null);
      session.run("nested", "child", "Verify", null);
      session.run("deleted-child", "ses_plain", "Deleted", 5000);
      const message = db.prepare(
        "INSERT INTO message (id, session_id, time_created, data, sequence) VALUES (?, ?, ?, ?, ?)"
      );
      const part = db.prepare(
        "INSERT INTO part (id, message_id, session_id, time_created, data, sequence) VALUES (?, ?, ?, ?, ?, 0)"
      );
      message.run(
        "compact-assistant",
        "ses_plain",
        3500,
        JSON.stringify({ role: "assistant", time: { created: 3500, completed: 3700 } }),
        boundaryFirst ? 3 : 2
      );
      message.run(
        "compact-user",
        "ses_plain",
        3800,
        JSON.stringify({ role: "user", time: { created: 3800 } }),
        boundaryFirst ? 2 : 3
      );
      part.run(
        "timeline",
        "compact-assistant",
        "ses_plain",
        3500,
        JSON.stringify({
          type: "compaction",
          operationId: "compact-1",
          auto: true,
          timelineStatus: "completed",
          preCompactTokenCount: 12000
        })
      );
      part.run(
        "boundary",
        "compact-user",
        "ses_plain",
        3800,
        JSON.stringify({
          type: "compaction",
          operationId: "compact-1",
          compactBoundary: { trigger: "auto", preCompactTokenCount: 12000 }
        })
      );
      for (const [id, at] of [
        ["child", 1500],
        ["nested", 2500],
        ["deleted-child", 100]
      ] as const) {
        message.run(`${id}-user`, id, at, JSON.stringify({ role: "user", time: { created: at } }), 0);
        part.run(`${id}-text`, `${id}-user`, id, at, JSON.stringify({ type: "text", text: "child prompt" }));
        message.run(
          `${id}-request`,
          id,
          at,
          JSON.stringify({
            role: "assistant",
            time: { created: at, completed: at + 100 },
            tokens: { input: 8, output: 3, reasoning: 1, cache: { read: 3, write: 4 } }
          }),
          1
        );
      }
      db.prepare("INSERT INTO session_entry (id, session_id, type, time_created, data) VALUES (?, ?, ?, ?, ?)").run(
        "tree-snap",
        "ses_plain",
        "runtime/prompt_snapshot",
        500,
        JSON.stringify({
          model: { providerId: "test", modelId: "test-model" },
          system: [{ role: "system", content: "Tree prompt" }]
        })
      );
      db.close();
      const ref = { agent: "zcode", path: treePath, sessionId: "ses_plain" };
      const loaded = await zcodeSessionAdapter.load(platform, ref);
      expect(loaded.ok).toBe(true);
      if (!loaded.ok) {
        return;
      }
      const transcript = loaded.value;
      expect(transcript.agents).toEqual([
        { id: "main" },
        { id: "child", parentId: "main", title: "Investigate" },
        { id: "nested", parentId: "child", title: "Verify" }
      ]);
      const compactions = transcript.events.filter((event) => event.kind === "compaction");
      expect(compactions).toHaveLength(1);
      expect(compactions[0]).toMatchObject({
        ts: 3800,
        payload: { trigger: "auto", preTokens: 12000 },
        original: { compactBoundary: { preCompactTokenCount: 12000 } }
      });
      expect(transcript.skipped.filter((skip) => skip.reason === "duplicate-compaction")).toHaveLength(1);
      expect(transcript.capabilities).toEqual(zcodeSessionAdapter.capabilities);
      const prompts = { limit: 10, maxChars: 100 };
      expect(await zcodeSessionAdapter.summarize!(platform, ref, { prompts })).toEqual({
        ok: true,
        value: { ...foldTranscript(transcript), prompts: sessionPrompts(transcript, prompts) }
      });
      expect(foldTranscript(transcript)).toEqual({
        turns: 1,
        requests: 4,
        inputTokens: 26,
        outputTokens: 11,
        durationMs: 1400,
        compactions: 1,
        subagents: 2,
        failedTools: 0,
        contextShape: [8, 10, 8]
      });
    }
  );

  it("keeps the version, prefers the AI SDK spellings, and pairs a tool call with its result", async () => {
    const result = await zcodeSessionAdapter.load(platform, {
      agent: "zcode",
      path: dbPath,
      sessionId: "ses_plain"
    });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.agentVersion).toBe("3.17.2");
    const request = result.value.events.find((event) => event.kind === "request");
    expect(request?.kind === "request" ? request.payload.model : undefined).toBe("test-model");
    const call = result.value.events.find((event) => event.kind === "tool_call");
    const out = result.value.events.find((event) => event.kind === "tool_result");
    expect(call?.kind === "tool_call" ? call.payload.callId : undefined).toBe("call-1");
    expect(out?.kind === "tool_result" ? out.payload.callId : undefined).toBe("call-1");
    expect(call?.source.sqlite?.table).toBe("part");
  });

  it("counts a part whose message row is missing as skipped", async () => {
    const result = await zcodeSessionAdapter.load(platform, {
      agent: "zcode",
      path: dbPath,
      sessionId: "ses_plain"
    });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    const orphaned = result.value.skipped.filter((skip) => skip.reason === "orphaned-part");
    expect(orphaned).toHaveLength(1);
    expect(orphaned[0]).toMatchObject({ source: { sqlite: { table: "part", rowid: ghostPartRowid } } });
  });

  it("orders messages by the app's sequence before their creation time", async () => {
    const result = await zcodeSessionAdapter.load(platform, {
      agent: "zcode",
      path: dbPath,
      sessionId: "ses_order"
    });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    const texts = result.value.events.flatMap((event) =>
      "text" in event.payload && typeof event.payload.text === "string" ? [event.payload.text] : []
    );
    expect(texts).toStrictEqual(["first", "second"]);
  });

  it("keeps the latest readable prompt snapshot as the session's system prompt", async () => {
    const ref = { agent: "zcode", path: dbPath, sessionId: "ses_snapshot" };
    const result = await zcodeSessionAdapter.load(platform, ref);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    const transcript = result.value;
    expect(transcript.session.systemPrompt).toBe("Second prompt");
    const snapshots = transcript.events.filter(
      (event) => event.kind === "system" && event.payload.type === "prompt_snapshot"
    );
    expect(snapshots).toHaveLength(2);
    expect(snapshots.map((event) => event.payload.systemPrompt)).toEqual(["First prompt", "Second prompt"]);
    const reasons = transcript.skipped.map((skip) => skip.reason);
    expect(reasons).toContain("empty-prompt-snapshot");
    expect(reasons).toContain("invalid-entry");
    expect(transcript.capabilities).toContain("systemPrompt");
    const summary = await zcodeSessionAdapter.summarize!(platform, ref);
    expect(summary.ok).toBe(true);
    if (summary.ok) {
      expect(summary.value).toStrictEqual(foldTranscript(transcript));
    }
  });

  it("attaches a child snapshot as the lane's system prompt", async () => {
    const result = await zcodeSessionAdapter.load(platform, {
      agent: "zcode",
      path: dbPath,
      sessionId: "ses_features"
    });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.agents[1]).toMatchObject({ id: "ses_child", systemPrompt: "Child prompt" });
  });

  it("treats a soft-deleted session as gone", async () => {
    const ref = { agent: "zcode", path: dbPath, sessionId: "ses_deleted" };
    expect(await zcodeSessionAdapter.detect(platform, ref)).toBe(false);
    const loaded = await zcodeSessionAdapter.load(platform, ref);
    expect(loaded.ok).toBe(false);
    if (!loaded.ok) {
      expect(loaded.error._tag).toBe("SessionNotFound");
    }
  });

  it("summarizes without materializing the transcript", async () => {
    const ref = { agent: "zcode", path: dbPath, sessionId: "ses_plain" };
    const loaded = await zcodeSessionAdapter.load(platform, ref);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) {
      return;
    }
    const base = platform.sqlite;
    // The bounded summarize fetches each message's data by rowid through `get`; an `all` that selects the message
    // table with its `data` column materializes the whole transcript.
    const guarded: SessionPlatform = {
      ...platform,
      sqlite: {
        open: (path, options) => {
          const db = base!.open(path, options);
          const prepare = db.prepare.bind(db);
          return {
            exec: (sql) => db.exec(sql),
            prepare: (sql) => {
              const statement = prepare(sql);
              const guard = (): void => {
                if (/from\s+message(?:\s|$)/i.test(sql) && /\bdata\b/.test(sql)) {
                  throw new Error(`materialized message data: ${sql}`);
                }
              };
              return {
                run: (...params: Parameters<typeof statement.run>) => statement.run(...params),
                get: (...params: Parameters<typeof statement.get>) => statement.get(...params),
                all: (...params: Parameters<typeof statement.all>) => {
                  guard();
                  return statement.all(...params);
                }
              };
            },
            close: () => db.close()
          };
        }
      }
    };
    const summary = await zcodeSessionAdapter.summarize!(guarded, ref);
    expect(summary.ok).toBe(true);
    if (!summary.ok) {
      return;
    }
    expect(summary.value).toStrictEqual(foldTranscript(loaded.value));
  });

  it("reads databases whose session table has no time_deleted column (e.g. ZCode 0.16.5)", async () => {
    const legacyRoot = await mkdtemp(join(tmpdir(), "agent-kit-zcode-legacy-"));
    try {
      mkdirSync(join(legacyRoot, "cli", "db"), { recursive: true });
      const legacyDbPath = join(legacyRoot, "cli", "db", "db.sqlite");
      const db = new DatabaseSync(legacyDbPath);
      db.exec(`
        create table session (
          rowid integer primary key,
          id text not null,
          title text not null,
          directory text not null,
          time_created integer not null,
          time_updated integer not null,
          version text not null,
          time_archived integer
        );
        create table message (
          rowid integer primary key,
          id text not null,
          session_id text not null,
          time_created integer not null,
          data text not null
        );
        create table part (
          rowid integer primary key,
          id text not null,
          message_id text not null,
          session_id text not null,
          time_created integer not null,
          data text not null
        );
      `);
      db.prepare(
        "insert into session (id, title, directory, time_created, time_updated, version, time_archived) values (?, ?, ?, ?, ?, ?, ?)"
      ).run("ses_legacy", "Legacy ZCode", "/u/me/work", 1000, 2000, "0.16.5", null);
      db.prepare("insert into message (id, session_id, time_created, data) values (?, ?, ?, ?)").run(
        "msg_u1",
        "ses_legacy",
        1000,
        JSON.stringify({ role: "user", time: { created: 1000 } })
      );
      db.prepare("insert into part (id, message_id, session_id, time_created, data) values (?, ?, ?, ?, ?)").run(
        "prt_u1",
        "msg_u1",
        "ses_legacy",
        1000,
        JSON.stringify({ type: "text", text: "hello legacy" })
      );
      db.prepare("insert into message (id, session_id, time_created, data) values (?, ?, ?, ?)").run(
        "msg_a1",
        "ses_legacy",
        1500,
        JSON.stringify({
          role: "assistant",
          tokens: { input: 10, output: 5, total: 15, cache: { read: 0, write: 0 } },
          modelId: "glm-test",
          finish: "stop",
          time: { created: 1500 }
        })
      );
      db.prepare("insert into part (id, message_id, session_id, time_created, data) values (?, ?, ?, ?, ?)").run(
        "prt_a1",
        "msg_a1",
        "ses_legacy",
        1600,
        JSON.stringify({ type: "text", text: "hi legacy" })
      );
      db.close();

      const items = [];
      for await (const item of zcodeSessionAdapter.discover(platform, legacyRoot)) {
        items.push(item);
      }
      expect(items).toHaveLength(1);
      expect("error" in items[0]!).toBe(false);
      const ref = { agent: "zcode" as const, path: legacyDbPath, sessionId: "ses_legacy" };
      expect(await zcodeSessionAdapter.detect(platform, ref)).toBe(true);
      const loaded = await zcodeSessionAdapter.load(platform, ref);
      expect(loaded.ok).toBe(true);
      const summary = await zcodeSessionAdapter.summarize!(platform, ref);
      expect(summary.ok).toBe(true);
      if (loaded.ok && summary.ok) {
        expect(summary.value).toStrictEqual(foldTranscript(loaded.value));
      }
    } finally {
      await rm(legacyRoot, { recursive: true, force: true });
    }
  });

  it("rejects with signal.reason when summarize is aborted before or during the pass", async () => {
    const ref = { agent: "zcode", path: dbPath, sessionId: "ses_plain" };
    const reason = new Error("stop-zcode");
    const preAborted = new AbortController();
    preAborted.abort(reason);
    await expect(zcodeSessionAdapter.summarize!(platform, ref, { signal: preAborted.signal })).rejects.toBe(reason);

    const midController = new AbortController();
    const midReason = new Error("mid-zcode");
    const base = platform.sqlite!;
    let messageReads = 0;
    const abortingPlatform: SessionPlatform = {
      ...platform,
      sqlite: {
        open: (path, options) => {
          const db = base.open(path, options);
          const prepare = db.prepare.bind(db);
          return {
            exec: (sql) => db.exec(sql),
            prepare: (sql) => {
              const statement = prepare(sql);
              return {
                run: (...params: Parameters<typeof statement.run>) => statement.run(...params),
                get: (...params: Parameters<typeof statement.get>) => {
                  const row = statement.get(...params);
                  if (/from\s+message(?:\s|$)/i.test(sql) && ++messageReads === 1) {
                    midController.abort(midReason);
                  }
                  return row;
                },
                all: (...params: Parameters<typeof statement.all>) => statement.all(...params)
              };
            },
            close: () => db.close()
          };
        }
      }
    };
    await expect(zcodeSessionAdapter.summarize!(abortingPlatform, ref, { signal: midController.signal })).rejects.toBe(
      midReason
    );
  });

  it("strips inherited forkOrigin messages from selection_side_chat child lanes while keeping new requests", async () => {
    const sideRoot = await mkdtemp(join(tmpdir(), "agent-kit-zcode-side-chat-"));
    try {
      const sideDbPath = join(sideRoot, "cli", "db", "db.sqlite");
      mkdirSync(join(sideRoot, "cli", "db"), { recursive: true });
      const db = new DatabaseSync(sideDbPath);
      db.exec(`
        CREATE TABLE session (
          id TEXT PRIMARY KEY,
          parent_id TEXT,
          task_type TEXT,
          title TEXT NOT NULL,
          directory TEXT NOT NULL,
          time_created INTEGER NOT NULL,
          time_updated INTEGER NOT NULL,
          version TEXT NOT NULL,
          time_deleted INTEGER
        );
        CREATE TABLE message (
          id TEXT PRIMARY KEY,
          session_id TEXT NOT NULL,
          time_created INTEGER NOT NULL,
          data TEXT NOT NULL,
          sequence INTEGER NOT NULL DEFAULT 0
        );
        CREATE TABLE part (
          id TEXT PRIMARY KEY,
          message_id TEXT NOT NULL,
          session_id TEXT NOT NULL,
          time_created INTEGER NOT NULL,
          data TEXT NOT NULL,
          sequence INTEGER NOT NULL DEFAULT 0
        );
      `);
      db.prepare(
        "INSERT INTO session (id, parent_id, task_type, title, directory, time_created, time_updated, version) VALUES (?, ?, ?, ?, '', ?, ?, '')"
      ).run("ses_root", null, "interactive", "Root", 1000, 3000);
      db.prepare(
        "INSERT INTO session (id, parent_id, task_type, title, directory, time_created, time_updated, version) VALUES (?, ?, ?, ?, '', ?, ?, '')"
      ).run("ses_side", "ses_root", "selection_side_chat", "Side chat", 2000, 3000);
      // Parent request: 40 input tokens, 500ms duration.
      db.prepare("INSERT INTO message (id, session_id, time_created, data, sequence) VALUES (?, ?, ?, ?, ?)").run(
        "m_root_u",
        "ses_root",
        1000,
        JSON.stringify({ role: "user", time: { created: 1000 } }),
        1
      );
      db.prepare(
        "INSERT INTO part (id, message_id, session_id, time_created, data, sequence) VALUES (?, ?, ?, ?, ?, ?)"
      ).run("p_root_u", "m_root_u", "ses_root", 1000, JSON.stringify({ type: "text", text: "root prompt" }), 1);
      db.prepare("INSERT INTO message (id, session_id, time_created, data, sequence) VALUES (?, ?, ?, ?, ?)").run(
        "m_root_a",
        "ses_root",
        1100,
        JSON.stringify({
          role: "assistant",
          modelId: "m1",
          time: { created: 1100, completed: 1600 },
          tokens: { input: 40, output: 10 }
        }),
        2
      );
      // Inherited copies in side chat carrying metadata.forkOrigin: must be skipped when attached to parent.
      db.prepare("INSERT INTO message (id, session_id, time_created, data, sequence) VALUES (?, ?, ?, ?, ?)").run(
        "m_side_copy_a",
        "ses_side",
        2000,
        JSON.stringify({
          role: "assistant",
          modelId: "m1",
          transcriptVisibility: "hidden",
          metadata: { forkOrigin: { sessionId: "ses_root", messageId: "m_root_a" } },
          time: { created: 1100, completed: 1600 },
          tokens: { input: 40, output: 10 }
        }),
        1
      );
      db.prepare(
        "INSERT INTO part (id, message_id, session_id, time_created, data, sequence) VALUES (?, ?, ?, ?, ?, ?)"
      ).run("p_side_copy_a", "m_side_copy_a", "ses_side", 2000, JSON.stringify({ type: "text", text: "copied" }), 1);
      // Genuine new request in side chat: 5 input tokens, 200ms duration.
      db.prepare("INSERT INTO message (id, session_id, time_created, data, sequence) VALUES (?, ?, ?, ?, ?)").run(
        "m_side_new_a",
        "ses_side",
        2500,
        JSON.stringify({
          role: "assistant",
          modelId: "m1",
          time: { created: 2500, completed: 2700 },
          tokens: { input: 5, output: 3 }
        }),
        2
      );
      db.close();

      const sidePlatform = createNodePlatform({ home: sideRoot });
      const ref = { agent: "zcode" as const, path: sideDbPath, sessionId: "ses_root" };
      const loaded = await zcodeSessionAdapter.load(sidePlatform, ref);
      const summary = await zcodeSessionAdapter.summarize!(sidePlatform, ref);
      expect(loaded.ok).toBe(true);
      expect(summary.ok).toBe(true);
      if (loaded.ok && summary.ok) {
        expect(loaded.value.events.filter((e) => e.kind === "request")).toHaveLength(2);
        expect(summary.value.requests).toBe(2);
        expect(summary.value.inputTokens).toBe(45);
        expect(summary.value.durationMs).toBe(700);
        expect(summary.value.subagents).toBe(1);
        expect(summary.value).toStrictEqual(foldTranscript(loaded.value));
      }
    } finally {
      await rm(sideRoot, { recursive: true, force: true });
    }
  });
});
