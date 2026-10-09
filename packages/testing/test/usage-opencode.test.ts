import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { PlatformSqlite } from "@rivus/agent-kit-platform";
import {
  decodeUsage,
  type DecodeUsageOptions,
  isUsageRecord,
  isUsageSource,
  listUsageSources,
  type UsageCursor,
  type UsagePlatform,
  type UsageRecord
} from "@rivus/agent-kit-sessions";
import { afterAll, describe, expect, it } from "vite-plus/test";

import { nodeReadFs, nodeSqlite } from "./support.js";

interface MessageRow {
  id: string;
  session_id: string;
  time_created: number;
  data: Record<string, unknown>;
}

const rows = JSON.parse(
  await readFile(new URL("fixtures/usage/opencode-messages.json", import.meta.url), "utf8")
) as MessageRow[];
const work = await mkdtemp(join(tmpdir(), "agent-kit-opencode-"));
afterAll(() => rm(work, { recursive: true, force: true }));
const sqlite = nodeSqlite();
let databases = 0;

/** A database as opencode 1.2 creates it, under a data home of its own, holding `seed`. */
async function database(seed: readonly MessageRow[] = rows): Promise<{ dataHome: string; path: string }> {
  const dataHome = join(work, `data-${databases++}`);
  await mkdir(join(dataHome, "opencode"), { recursive: true });
  const path = join(dataHome, "opencode", "opencode.db");
  const db = sqlite.open(path);
  db.exec(
    "CREATE TABLE message (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, time_created INTEGER NOT NULL, " +
      "time_updated INTEGER NOT NULL, data TEXT NOT NULL)"
  );
  // One connection and one transaction: a commit per row made the 1,200-row seed exceed the CI test timeout.
  const statement = db.prepare("INSERT INTO message VALUES (?, ?, ?, ?, ?)");
  db.exec("BEGIN");
  for (const row of seed) {
    statement.run(row.id, row.session_id, row.time_created, row.time_created, JSON.stringify(row.data));
  }
  db.exec("COMMIT");
  db.close();
  return { dataHome, path };
}

function insert(path: string, row: MessageRow): void {
  const db = sqlite.open(path);
  db.prepare("INSERT INTO message VALUES (?, ?, ?, ?, ?)").run(
    row.id,
    row.session_id,
    row.time_created,
    row.time_created,
    JSON.stringify(row.data)
  );
  db.close();
}

function update(path: string, id: string, data: Record<string, unknown>, updated: number): void {
  const db = sqlite.open(path);
  db.prepare("UPDATE message SET data = ?, time_updated = ? WHERE id = ?").run(JSON.stringify(data), updated, id);
  db.close();
}

/** msg_5 of the fixture, finished with 7 input tokens. */
const finished = {
  ...rows[4]!.data,
  tokens: { input: 7, output: 1, reasoning: 0, cache: { read: 0, write: 0 }, total: 8 },
  time: { created: 1767225606000, completed: 1767225607000 }
};

const platform: UsagePlatform = { fs: nodeReadFs(), sqlite };

async function decode(
  path: string,
  options: DecodeUsageOptions = {},
  on: UsagePlatform = platform
): Promise<{ records: UsageRecord[]; failures: string[]; cursor: UsageCursor | undefined }> {
  const stream = decodeUsage(on, "opencode", { path }, options);
  const records: UsageRecord[] = [];
  const failures: string[] = [];
  for await (const item of stream) {
    if (isUsageRecord(item)) {
      records.push(item);
    } else {
      failures.push(item.error._tag);
    }
  }
  const cursor = stream.cursor === undefined ? undefined : (JSON.parse(JSON.stringify(stream.cursor)) as UsageCursor);
  return { records, failures, cursor };
}

/** Decodes `path` the way a caller that leaves the loop after `take` records does, with the cursor read there. */
async function decodePart(
  path: string,
  take: number,
  options: DecodeUsageOptions = {},
  on: UsagePlatform = platform
): Promise<{ records: UsageRecord[]; cursor: UsageCursor | undefined }> {
  const stream = decodeUsage(on, "opencode", { path }, options);
  const records: UsageRecord[] = [];
  for await (const item of stream) {
    if (!isUsageRecord(item)) {
      continue;
    }
    records.push(item);
    if (records.length >= take) {
      break;
    }
  }
  const cursor = stream.cursor === undefined ? undefined : (JSON.parse(JSON.stringify(stream.cursor)) as UsageCursor);
  return { records, cursor };
}

/** Resumes from the cursor of a decode the caller left, until the source gives nothing more. */
async function decodeRest(
  path: string,
  cursor: UsageCursor | undefined,
  options: DecodeUsageOptions = {}
): Promise<UsageRecord[]> {
  const records: UsageRecord[] = [];
  let from = cursor;
  while (from) {
    const next = await decode(path, { ...options, from });
    records.push(...next.records);
    from = next.records.length > 0 ? next.cursor : undefined;
  }
  return records;
}

/** The request ids of `records`, what the stop-and-resume comparisons assert about. */
const ids = (records: readonly UsageRecord[]): (string | undefined)[] => records.map((record) => record.requestId);

describe("opencode usage (SQLite)", () => {
  it("reads finished assistant messages with the logged cost, input with cache and output with reasoning", async () => {
    const { path } = await database();
    const { records } = await decode(path);
    expect(records.map((record) => record.requestId)).toEqual(["msg_1", "msg_3", "msg_4"]);
    expect(records[0]).toEqual({
      agent: "opencode",
      sessionId: "ses_1",
      granularity: "request",
      requestId: "msg_1",
      timestamp: 1767225601000,
      model: "model-test",
      provider: "provider-test",
      costUsd: 0.02104008,
      costSource: "agent",
      usage: {
        inputTokens: 79968,
        outputTokens: 2494,
        totalTokens: 82462,
        cacheReadTokens: 79488,
        cacheWriteTokens: 0,
        reasoningTokens: 2030
      },
      source: { file: path, offset: 0, length: 0, line: 1 }
    });
    expect(records[1]?.costUsd).toBe(0);
  });

  it("filters by the message's completion time", async () => {
    const { path } = await database();
    const { records } = await decode(path, { since: Date.parse("2026-01-01T00:00:00.000Z") });
    expect(records.map((record) => record.requestId)).toEqual(["msg_1", "msg_3"]);
  });

  it("reports a running message once it has finished, and the rows added after the cursor", async () => {
    const { path } = await database();
    const first = await decode(path);
    expect(first.cursor?.state).toMatchObject({ running: ["msg_5"] });
    update(path, "msg_5", finished, 1767225607000);
    insert(path, { ...rows[2]!, id: "msg_6", time_created: 1767225608000 });
    const next = await decode(path, first.cursor ? { from: first.cursor } : {});
    expect(next.records.map((record) => [record.requestId, record.usage.inputTokens])).toEqual([
      ["msg_5", 7],
      ["msg_6", 10]
    ]);
    expect(next.cursor?.state).toMatchObject({ running: [] });
  });

  it("finds a row inserted after a revert deleted the last ones, though SQLite reuses their row ids", async () => {
    const { path } = await database();
    const first = await decode(path);
    const db = sqlite.open(path);
    db.prepare("DELETE FROM message WHERE id IN ('msg_4', 'msg_5')").run();
    db.close();
    insert(path, { ...rows[2]!, id: "msg_7", time_created: 1767225610000 });
    const next = await decode(path, first.cursor ? { from: first.cursor } : {});
    expect(next.records.map((record) => [record.requestId, record.source.line])).toEqual([["msg_7", 4]]);
  });

  it("counts a message that never finished at its creation time once the database is final", async () => {
    const { path } = await database();
    const first = await decode(path);
    expect(first.records.map((record) => record.requestId)).not.toContain("msg_5");
    const last = await decode(path, { ...(first.cursor ? { from: first.cursor } : {}), final: true });
    expect(last.records.map((record) => [record.requestId, record.timestamp])).toEqual([["msg_5", 1767225606000]]);
    expect((await decode(path, { final: true })).records.map((record) => record.requestId)).toContain("msg_5");
  });

  it("keeps the running messages in the cursor when looking them up fails", async () => {
    const { path } = await database();
    const first = await decode(path);
    const failing: PlatformSqlite = {
      open(target, options) {
        const db = sqlite.open(target, options);
        return {
          exec: (sql) => db.exec(sql),
          close: () => db.close(),
          prepare(sql) {
            if (sql.includes("WHERE id IN")) {
              throw Object.assign(new Error("database is locked"), { code: "ERR_SQLITE_ERROR" });
            }
            return db.prepare(sql);
          }
        };
      }
    };
    const last = await decode(
      path,
      { ...(first.cursor ? { from: first.cursor } : {}), final: true },
      { fs: nodeReadFs(), sqlite: failing }
    );
    expect(last.failures).toEqual(["ReadFailed"]);
    expect(last.cursor?.state).toMatchObject({ running: ["msg_5"] });
  });

  it("yields the same records when a decode stops at any record and its cursor resumes", async () => {
    const { path } = await database();
    const full = (await decode(path)).records.map((record) => record.requestId);
    for (const until of (await decode(path)).records.map((record) => record.timestamp)) {
      const head = await decode(path, { until });
      const next = await decode(path, head.cursor ? { from: head.cursor } : {});
      expect([...head.records, ...next.records].map((record) => record.requestId)).toEqual(full);
    }
  });

  it("gives one first read's records when the caller stops after each record and resumes", async () => {
    const { path } = await database();
    const full = ids((await decode(path)).records);
    for (let take = 1; take <= full.length; take++) {
      const head = await decodePart(path, take);
      const rest = await decodeRest(path, head.cursor);
      expect([...ids(head.records), ...ids(rest)]).toEqual(full);
    }
  });

  it("gives one continuing decode's records when the caller stops after each record and resumes", async () => {
    const { path } = await database();
    const first = await decode(path);
    update(path, "msg_5", finished, 1767225607000);
    insert(path, { ...rows[2]!, id: "msg_6", time_created: 1767225608000 });
    const whole = ids((await decode(path, first.cursor ? { from: first.cursor } : {})).records);
    expect(whole).toEqual(["msg_5", "msg_6"]);
    for (let take = 1; take <= whole.length; take++) {
      const head = await decodePart(path, take, first.cursor ? { from: first.cursor } : {});
      const rest = await decodeRest(path, head.cursor);
      expect([...ids(head.records), ...ids(rest)]).toEqual(whole);
    }
  });

  it("gives one final decode's records when the caller stops after each record and resumes", async () => {
    // A final decode that continues from a state with two running messages reports them all in its final look; a
    // fresh final decode reports them through the pages instead, which the by-row stop above already covers.
    const { path } = await database([...rows, { ...rows[4]!, id: "msg_5b", time_created: 1767225609000 }]);
    const first = await decode(path);
    expect(first.cursor?.state).toMatchObject({ running: ["msg_5", "msg_5b"] });
    const whole = ids((await decode(path, { ...(first.cursor ? { from: first.cursor } : {}), final: true })).records);
    expect(whole).toEqual(["msg_5", "msg_5b"]);
    for (let take = 1; take <= whole.length; take++) {
      const head = await decodePart(path, take, { ...(first.cursor ? { from: first.cursor } : {}), final: true });
      const rest = await decodeRest(path, head.cursor, { final: true });
      expect([...ids(head.records), ...ids(rest)]).toEqual(whole);
    }
  });

  it("gives the records of one final decode when decoded as rows are added and finish", async () => {
    const { path } = await database([]);
    const records: UsageRecord[] = [];
    let cursor: UsageCursor | undefined;
    const step = async (final = false) => {
      const next = await decode(path, { ...(cursor ? { from: cursor } : {}), ...(final ? { final } : {}) });
      records.push(...next.records);
      cursor = next.cursor;
    };
    for (const row of rows) {
      insert(path, row);
      await step();
    }
    update(path, "msg_5", finished, 1767225607000);
    await step(true);
    expect(records).toEqual((await decode(path, { final: true })).records);
  });

  it("reads a database the first time in one pass by row id, without sorting the table for every page", async () => {
    const many = Array.from({ length: 1200 }, (_, index) => ({
      ...rows[2]!,
      id: `msg_${String(index).padStart(5, "0")}`,
      time_created: 1767225600000 + index
    }));
    const { path } = await database(many);
    const statements: string[] = [];
    const recording: PlatformSqlite = {
      open(target, options) {
        const db = sqlite.open(target, options);
        return {
          exec: (sql) => db.exec(sql),
          close: () => db.close(),
          prepare(sql) {
            statements.push(sql);
            return db.prepare(sql);
          }
        };
      }
    };
    const { records } = await decode(path, {}, { fs: nodeReadFs(), sqlite: recording });
    expect(records).toHaveLength(1200);
    expect(statements.filter((sql) => sql.includes("ORDER BY rowid"))).toHaveLength(3);
    expect(statements.filter((sql) => sql.includes("ORDER BY time_updated")).length).toBeLessThanOrEqual(1);
  });

  it("returns SqliteUnavailable when the platform has no SQLite", async () => {
    const { path } = await database();
    const { records, failures } = await decode(path, {}, { fs: nodeReadFs() });
    expect(records).toEqual([]);
    expect(failures).toEqual(["SqliteUnavailable"]);
  });

  it("lists the database under XDG_DATA_HOME", async () => {
    const { dataHome, path } = await database();
    const sources = [];
    for await (const item of listUsageSources(
      { ...platform, env: { XDG_DATA_HOME: dataHome }, home: "/u/me" },
      { agents: ["opencode"] }
    )) {
      sources.push(isUsageSource(item) ? item.path : item.error._tag);
    }
    expect(sources).toEqual([path]);
  });
});
