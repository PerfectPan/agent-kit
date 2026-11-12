import { mkdirSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { afterAll, describe, expect, it } from "vite-plus/test";

import { createNodePlatform } from "@rivus/agent-kit-platform-node/public";
import { foldTranscript, type SessionPlatform } from "@rivus/agent-kit-sessions/public";
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
  db.close();

  const rows = new DatabaseSync(dbPath, { readOnly: true });
  const keysFor = (sessionId: string): string[] => {
    const out: string[] = [`${dbPath}\0${1}`];
    let line = 2;
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
      sessionId: "ses_plain",
      records: 9,
      recordKeys: keysFor("ses_plain"),
      capabilities: ["requests", "usage", "reasoning"]
    },
    {
      path: dbPath,
      sessionId: "ses_unknown",
      records: 5,
      recordKeys: keysFor("ses_unknown"),
      capabilities: ["requests", "usage"]
    },
    {
      path: dbPath,
      sessionId: "ses_order",
      records: 4,
      recordKeys: keysFor("ses_order"),
      capabilities: ["requests"]
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
});
