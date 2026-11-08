import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { afterAll, describe, expect, it } from "vite-plus/test";

import { createNodePlatform } from "@rivus/agent-kit-platform-node/public";
import { foldTranscript, type SessionPlatform } from "@rivus/agent-kit-sessions/public";
import { sessionAdapterConformance, type ConformanceSession } from "@rivus/agent-kit-testing/public";
import { opencodeSessionAdapter } from "../src/sessions.js";

const tempRoot = await mkdtemp(join(tmpdir(), "agent-kit-opencode-"));
afterAll(() => rm(tempRoot, { recursive: true, force: true }));

const dbPath = join(tempRoot, "opencode.db");

function createDatabase(): { sessions: ConformanceSession[]; ghostPartRowid: number } {
  const db = new DatabaseSync(dbPath);
  db.exec(`
    create table session (
      rowid integer primary key,
      id text not null,
      title text not null,
      directory text not null,
      time_created integer not null,
      time_updated integer not null,
      version text not null
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
  const session = db.prepare(
    "insert into session (id, title, directory, time_created, time_updated, version) values (?, ?, ?, ?, ?, ?)"
  );
  const message = db.prepare("insert into message (id, session_id, time_created, data) values (?, ?, ?, ?)");
  const part = db.prepare("insert into part (id, message_id, session_id, time_created, data) values (?, ?, ?, ?, ?)");

  session.run("ses_plain", "Plain session", "/u/me/work", 1000, 3000, "1.18.5");
  message.run("msg_u1", "ses_plain", 1000, JSON.stringify({ role: "user", time: { created: 1000 } }));
  part.run("prt_t1", "msg_u1", "ses_plain", 1000, JSON.stringify({ type: "text", text: "hello" }));
  message.run(
    "msg_a1",
    "ses_plain",
    2000,
    JSON.stringify({
      role: "assistant",
      tokens: { input: 10, output: 5, reasoning: 2, total: 17, cache: { read: 0, write: 0 } },
      modelID: "test-model",
      providerID: "test",
      finish: "tool-calls",
      time: { created: 2000, completed: 3000 }
    })
  );
  part.run("prt_r1", "msg_a1", "ses_plain", 2100, JSON.stringify({ type: "reasoning", text: "think" }));
  part.run("prt_x1", "msg_a1", "ses_plain", 2200, JSON.stringify({ type: "text", text: "hi" }));
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
    })
  );
  part.run("prt_s1", "msg_a1", "ses_plain", 2400, JSON.stringify({ type: "step-start" }));
  // A part whose message row does not exist: the loader counts it as skipped instead of dropping it.
  const ghost = part.run("prt_o1", "msg_ghost", "ses_plain", 2500, JSON.stringify({ type: "text", text: "ghost" }));
  const ghostPartRowid = Number(ghost.lastInsertRowid);

  session.run("ses_unknown", "Unknown part", "/u/me/work", 4000, 5000, "1.18.5");
  message.run("msg_u2", "ses_unknown", 4000, JSON.stringify({ role: "user", time: { created: 4000 } }));
  part.run("prt_t2", "msg_u2", "ses_unknown", 4000, JSON.stringify({ type: "text", text: "again" }));
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
    })
  );
  part.run("prt_z1", "msg_a2", "ses_unknown", 5100, JSON.stringify({ type: "mystery" }));
  db.close();

  const rows = new DatabaseSync(dbPath, { readOnly: true });
  const keysFor = (sessionId: string): string[] => {
    const out: string[] = [`${dbPath}\0${1}`];
    let line = 2;
    const messages = rows
      .prepare("select id from message where session_id = ? order by time_created, id")
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
      records: 8,
      recordKeys: keysFor("ses_plain"),
      capabilities: ["requests", "usage", "reasoning"]
    },
    {
      path: dbPath,
      sessionId: "ses_unknown",
      records: 5,
      recordKeys: keysFor("ses_unknown"),
      capabilities: ["requests", "usage"]
    }
  ];
  rows.close();
  return { sessions, ghostPartRowid };
}

const { sessions, ghostPartRowid } = createDatabase();

describe("opencode conformance (sqlite)", () => {
  const platform = createNodePlatform({ home: tempRoot });
  const checks = sessionAdapterConformance(opencodeSessionAdapter, {
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

describe("opencode adapter", () => {
  const platform = createNodePlatform({ home: tempRoot });

  it("keeps the version and pairs a tool call with its result", async () => {
    const result = await opencodeSessionAdapter.load(platform, {
      agent: "opencode",
      path: dbPath,
      sessionId: "ses_plain"
    });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.agentVersion).toBe("1.18.5");
    const call = result.value.events.find((event) => event.kind === "tool_call");
    const out = result.value.events.find((event) => event.kind === "tool_result");
    expect(call?.kind === "tool_call" ? call.payload.callId : undefined).toBe("call-1");
    expect(out?.kind === "tool_result" ? out.payload.callId : undefined).toBe("call-1");
    expect(call?.source.sqlite?.table).toBe("part");
  });

  it("counts a part whose message row is missing as skipped", async () => {
    const result = await opencodeSessionAdapter.load(platform, {
      agent: "opencode",
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

  it("summarizes without materializing the transcript", async () => {
    const ref = { agent: "opencode", path: dbPath, sessionId: "ses_plain" };
    const loaded = await opencodeSessionAdapter.load(platform, ref);
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
    const summary = await opencodeSessionAdapter.summarize!(guarded, ref);
    expect(summary.ok).toBe(true);
    if (!summary.ok) {
      return;
    }
    expect(summary.value).toStrictEqual(foldTranscript(loaded.value));
  });
});
