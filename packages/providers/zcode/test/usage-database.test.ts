import { usageDecoderConformance } from "@rivus/agent-kit-testing/public";
import { homeFromRule } from "@rivus/agent-kit-catalog/spi";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  decodeUsage,
  type DecodeUsageOptions,
  isUsageRecord,
  isUsageSource,
  listUsageSources,
  type UsageCursor,
  type UsagePlatform,
  type UsageRecord
} from "@rivus/agent-kit-sessions/public";
import { afterAll, describe, expect, it } from "vite-plus/test";
import { createNodePlatform } from "@rivus/agent-kit-platform-node/public";
import { zcodeUsageDecoder } from "../src/usage.js";
import { zcode } from "../src/identity.js";

const testUsage = { zcode: zcodeUsageDecoder };
const testIdentity = { zcode };
type PlatformSqlite = NonNullable<UsagePlatform["sqlite"]>;

interface MessageRow {
  id: string;
  session_id: string;
  time_created: number;
  data: Record<string, unknown>;
}

const rows = JSON.parse(await readFile(new URL("fixtures/messages.json", import.meta.url), "utf8")) as MessageRow[];
const work = await mkdtemp(join(tmpdir(), "agent-kit-zcode-"));
afterAll(() => rm(work, { recursive: true, force: true }));
const node = createNodePlatform({ home: work, env: {} });
const sqlite = node.sqlite!;
let databases = 0;

/** A database as ZCode creates it, under a storage dir of its own, holding `seed`. */
async function database(seed: readonly MessageRow[] = rows): Promise<{ storage: string; path: string }> {
  const storage = join(work, `storage-${databases++}`);
  await mkdir(join(storage, "cli", "db"), { recursive: true });
  const path = join(storage, "cli", "db", "db.sqlite");
  const db = sqlite.open(path);
  // The real table's `session_id` references `session(id)` on delete cascade; the fixture schema leaves the FK out,
  // which nothing the decoder reads depends on, so no `session` rows are needed.
  db.exec(
    "CREATE TABLE message (id text primary key, session_id text not null, " +
      "time_created integer not null, time_updated integer not null, data text not null, sequence integer)"
  );
  // One connection and one transaction: a commit per row made the 1,200-row seed exceed the CI test timeout.
  const statement = db.prepare("INSERT INTO message VALUES (?, ?, ?, ?, ?, NULL)");
  db.exec("BEGIN");
  for (const row of seed) {
    statement.run(row.id, row.session_id, row.time_created, row.time_created, JSON.stringify(row.data));
  }
  db.exec("COMMIT");
  db.close();
  return { storage, path };
}

function insert(path: string, row: MessageRow): void {
  const db = sqlite.open(path);
  db.prepare("INSERT INTO message VALUES (?, ?, ?, ?, ?, NULL)").run(
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

/** msg_5 of the fixture, finished with 7 input tokens. Its update time stays above the newest row the first read saw. */
const finished = {
  ...rows[4]!.data,
  tokens: { input: 7, output: 1, reasoning: 0, cache: { read: 0, write: 0 }, total: 8 },
  time: { created: 1767225606000, completed: 1767225607500 }
};

const platform: UsagePlatform = { fs: node.fs, sqlite };

async function decode(
  path: string,
  options: DecodeUsageOptions = {},
  on: UsagePlatform = platform
): Promise<{ records: UsageRecord[]; failures: string[]; cursor: UsageCursor | undefined }> {
  const stream = decodeUsage(
    on,
    "zcode",
    { path },
    { ...options, providers: { usage: testUsage, identity: testIdentity } }
  );
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
  const stream = decodeUsage(
    on,
    "zcode",
    { path },
    { ...options, providers: { usage: testUsage, identity: testIdentity } }
  );
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

describe("zcode usage (SQLite)", () => {
  it("reads finished assistant messages with the input as stored, cache already inside it", async () => {
    const { path } = await database();
    const { records } = await decode(path);
    expect(records.map((record) => record.requestId)).toEqual(["msg_1", "msg_3", "msg_4"]);
    expect(records[0]).toEqual({
      agent: "zcode",
      sessionId: "ses_1",
      granularity: "request",
      requestId: "msg_1",
      timestamp: 1767225601000,
      model: "GLM-test",
      provider: "account:bigmodel-test",
      costUsd: 0,
      costSource: "agent",
      usage: {
        inputTokens: 1000,
        outputTokens: 200,
        totalTokens: 1200,
        cacheReadTokens: 900,
        cacheWriteTokens: 50,
        reasoningTokens: 80
      },
      source: { file: path, offset: 0, length: 0, line: 1 }
    });
    expect(records[1]?.costUsd).toBe(0);
  });

  it("derives the total of a message that reports none, and skips a message without tokens", async () => {
    const { path } = await database();
    const { records } = await decode(path);
    expect(records[1]?.usage).toEqual({
      inputTokens: 10,
      outputTokens: 5,
      totalTokens: 15,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      reasoningTokens: 0
    });
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
    update(path, "msg_5", finished, 1767225607500);
    insert(path, { ...rows[0]!, id: "msg_7", session_id: "ses_1", time_created: 1767225608000 });
    const next = await decode(path, first.cursor ? { from: first.cursor } : {});
    expect(next.records.map((record) => [record.requestId, record.usage.inputTokens])).toEqual([
      ["msg_5", 7],
      ["msg_7", 1000]
    ]);
    expect(next.cursor?.state).toMatchObject({ running: [] });
  });

  it("counts a message that never finished at its creation time once the database is final", async () => {
    const { path } = await database();
    const first = await decode(path);
    expect(first.records.map((record) => record.requestId)).not.toContain("msg_5");
    const last = await decode(path, { ...(first.cursor ? { from: first.cursor } : {}), final: true });
    expect(last.records.map((record) => [record.requestId, record.timestamp])).toEqual([["msg_5", 1767225606000]]);
    expect((await decode(path, { final: true })).records.map((record) => record.requestId)).toContain("msg_5");
  });

  it("finds a row inserted after a revert deleted the last ones, though SQLite reuses their row ids", async () => {
    const { path } = await database();
    const first = await decode(path);
    const db = sqlite.open(path);
    db.prepare("DELETE FROM message WHERE id IN ('msg_5', 'msg_6')").run();
    db.close();
    insert(path, { ...rows[0]!, id: "msg_8", session_id: "ses_1", time_created: 1767225610000 });
    const next = await decode(path, first.cursor ? { from: first.cursor } : {});
    expect(next.records.map((record) => [record.requestId, record.source.line])).toEqual([["msg_8", 5]]);
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
      { fs: node.fs, sqlite: failing }
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
    update(path, "msg_5", finished, 1767225607500);
    insert(path, { ...rows[0]!, id: "msg_7", session_id: "ses_1", time_created: 1767225608000 });
    const whole = ids((await decode(path, first.cursor ? { from: first.cursor } : {})).records);
    expect(whole).toEqual(["msg_5", "msg_7"]);
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
    update(path, "msg_5", finished, 1767225607500);
    await step(true);
    expect(records).toEqual((await decode(path, { final: true })).records);
  });

  it("reads a database the first time in one pass by row id, without sorting the table for every page", async () => {
    const many = Array.from({ length: 1200 }, (_, index) => ({
      ...rows[0]!,
      id: `msg_${String(index).padStart(5, "0")}`,
      session_id: "ses_1",
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
    const { records } = await decode(path, {}, { fs: node.fs, sqlite: recording });
    expect(records).toHaveLength(1200);
    expect(statements.filter((sql) => sql.includes("ORDER BY rowid"))).toHaveLength(3);
    expect(statements.filter((sql) => sql.includes("ORDER BY time_updated")).length).toBeLessThanOrEqual(1);
  });

  it("returns SqliteUnavailable when the platform has no SQLite", async () => {
    const { path } = await database();
    const { records, failures } = await decode(path, {}, { fs: node.fs });
    expect(records).toEqual([]);
    expect(failures).toEqual(["SqliteUnavailable"]);
  });

  it("lists the database under ZCODE_STORAGE_DIR", async () => {
    const { storage, path } = await database();
    const sources = [];
    for await (const item of listUsageSources(
      { ...platform, env: { ZCODE_STORAGE_DIR: storage }, home: "/u/me" },
      { agents: ["zcode"], providers: { usage: testUsage, identity: testIdentity } }
    )) {
      sources.push(isUsageSource(item) ? item.path : item.error._tag);
    }
    expect(sources).toEqual([path]);
  });
});

const conformanceDatabase = await database();
describe("zcode SQLite usage conformance", () => {
  for (const { name, run } of usageDecoderConformance(zcodeUsageDecoder, {
    platform,
    home: homeFromRule("zcode", zcode.home, { home: work, env: { ZCODE_STORAGE_DIR: conformanceDatabase.storage } }),
    sources: [{ path: conformanceDatabase.path, records: 4 }]
  })) {
    it(`${name}`, async () => {
      await expect(run()).resolves.toBeUndefined();
    });
  }
});
