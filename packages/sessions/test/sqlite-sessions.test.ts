import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import {
  createSqliteSessionAdapter,
  type SqliteSessionLayout
} from "../src/application/services/session-adapters/sqlite.js";
import { sqliteSessionMessageOf } from "../src/application/services/usage-decoders/sqlite.js";
import { foldTranscript } from "../src/domain/transcript/services/fold-transcript.js";
import { sessionPrompts } from "../src/domain/transcript/services/turns.js";
import * as turns from "../src/domain/transcript/services/turns.js";
import { sqliteFixture } from "./fixtures/sqlite.js";

const fixtures: ReturnType<typeof sqliteFixture>[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const fixture of fixtures.splice(0)) {
    fixture.close();
  }
});

function setup(legacy = false, options: Partial<SqliteSessionLayout> = {}) {
  const fixture = sqliteFixture(legacy);
  fixtures.push(fixture);
  const adapter = createSqliteSessionAdapter({
    agent: "example",
    databaseFile: "sessions.db",
    sessionNoun: "a session",
    softDeletes: true,
    messageSequence: true,
    message: (value) =>
      sqliteSessionMessageOf(value, (tokens) =>
        tokens === undefined ? undefined : { inputTokens: tokens.input, outputTokens: tokens.output }
      ),
    ...options
  });
  const ref = { agent: "example", path: fixture.path, sessionId: "root" };
  async function parity(prompts = { limit: 10, maxChars: 20 }) {
    const loaded = await adapter.load(fixture.platform, ref);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) {
      throw new Error(loaded.error._tag);
    }
    fixture.controls.materializedMessages = false;
    const summary = await adapter.summarize!(fixture.platform, ref);
    expect(summary).toStrictEqual({ ok: true, value: foldTranscript(loaded.value) });
    const preview = await adapter.summarize!(fixture.platform, ref, { prompts });
    expect(preview).toStrictEqual({
      ok: true,
      value: { ...foldTranscript(loaded.value), prompts: sessionPrompts(loaded.value, prompts) }
    });
    expect(fixture.controls.materializedMessages).toBe(false);
    return loaded.value;
  }
  return { ...fixture, adapter, ref, parity };
}

/** These cases write and read thousands of rows; a Windows runner's SQLite takes longer than the default 5 seconds. */
const SLOW_RUNNER_MS = 30_000;

describe("SQLite session capabilities", () => {
  it.each([
    [{ created: 10, completed: 25 }, 15],
    [{ created: 0, completed: 0 }, 0],
    [{ created: 10, completed: 9 }, undefined],
    [{ created: 10 }, undefined],
    [{ completed: 25 }, undefined],
    [{ created: "10", completed: 25 }, undefined],
    [{ created: 10, completed: "25" }, undefined],
    [{ created: null, completed: null }, undefined],
    [{ created: -Number.MAX_VALUE, completed: Number.MAX_VALUE }, undefined]
  ])("uses only recorded finite, ordered request times: %j", async (time, duration) => {
    const f = setup();
    f.session("root");
    f.message("root", { role: "assistant", time }, 1);
    const transcript = await f.parity();
    expect(transcript.events[0]?.payload.durationMs).toBe(duration);
    expect(transcript.capabilities.includes("durations")).toBe(duration !== undefined);
    expect(foldTranscript(transcript).durationMs).toBe(duration);
  });

  it.each([NaN, Infinity, -Infinity])("rejects a nonfinite provider completion: %s", async (completed) => {
    const f = setup(false, {
      message: () => ({
        role: "assistant",
        created: 10,
        completed,
        model: undefined,
        finish: undefined,
        usage: undefined
      })
    });
    f.session("root");
    f.message("root", {});
    const transcript = await f.parity();
    expect(transcript.capabilities).toEqual(["requests"]);
  });

  it.each([false, true])(
    "prefers boundary records regardless of mirror order (boundary first: %s)",
    async (boundaryFirst) => {
      const f = setup();
      f.session("root");
      const timeline = {
        type: "compaction",
        operationId: "operation",
        timelineStatus: "completed",
        trigger: "auto",
        preCompactTokenCount: 900
      };
      const boundary = {
        type: "compaction",
        operationId: "operation",
        compactBoundary: { trigger: "manual", preCompactTokenCount: 0 }
      };
      const records = boundaryFirst
        ? ([
            ["user", boundary],
            ["assistant", timeline]
          ] as const)
        : ([
            ["assistant", timeline],
            ["user", boundary]
          ] as const);
      let selected = 0;
      for (const [role, part] of records) {
        const message = f.message("root", { role });
        const rowid = f.part("root", message, part);
        if (role === "user") {
          selected = rowid;
        }
      }
      const transcript = await f.parity();
      const compactions = transcript.events.filter((event) => event.kind === "compaction");
      expect(compactions).toHaveLength(1);
      expect(compactions[0]).toMatchObject({
        payload: { trigger: "manual", preTokens: 0 },
        source: { sqlite: { rowid: selected } }
      });
      expect(transcript.skipped.filter((skip) => skip.reason === "duplicate-compaction")).toHaveLength(1);
      expect(foldTranscript(transcript).compactions).toBe(1);
      expect(transcript.capabilities).toEqual(["requests", "compaction", "compactionTokens"]);
    }
  );

  it("keeps independent compactions and parses malformed optional metadata leniently", async () => {
    const f = setup();
    f.session("root");
    const message = f.message("root", { role: "user" });
    for (const part of [
      { auto: true },
      { auto: false },
      { preCompactTokenCount: -1, trigger: "unknown" },
      { preCompactTokenCount: "100", compactBoundary: [] },
      { auto: "yes", operationId: 7, compactBoundary: { preCompactTokenCount: -3 } },
      { trigger: "manual", preCompactTokenCount: 123 },
      { compactBoundary: { trigger: "auto", preCompactTokenCount: 0 } }
    ]) {
      f.part("root", message, { type: "compaction", ...part });
    }
    const transcript = await f.parity();
    expect(transcript.events.map((event) => event.payload)).toEqual([
      { trigger: "auto" },
      { trigger: "manual" },
      {},
      {},
      {},
      { trigger: "manual", preTokens: 123 },
      { trigger: "auto", preTokens: 0 }
    ]);
    expect(foldTranscript(transcript)).toEqual({ turns: 0, compactions: 7, failedTools: 0 });
  });

  it("merges nested lanes chronologically while counting only root turns and prompts", async () => {
    const f = setup();
    f.session("root");
    f.session("child", "root", "Research");
    f.session("nested", "child", "");
    f.session("empty", "root");
    f.session("deleted", "root", "", 9);
    f.session("unreachable", "deleted");
    for (const [sessionId, at, input, output, duration] of [
      ["root", 30, 30, 3, 8],
      ["child", 10, 10, 1, 4],
      ["nested", 20, 20, 2, 0],
      ["deleted", 1, 999, 999, 999]
    ] as const) {
      const user = f.message(sessionId, { role: "user", time: { created: at } });
      f.part(sessionId, user, { type: "text", text: `${sessionId} prompt` }, at);
      const request = f.message(sessionId, {
        role: "assistant",
        time: { created: at, completed: at + duration },
        tokens: { input, output }
      });
      f.part(sessionId, request, { type: "reasoning", text: "thinking" }, at);
      f.part(
        sessionId,
        request,
        { type: "tool", callID: "reused-call", state: { status: "error", error: "failed" } },
        at
      );
      f.part(sessionId, user, { type: "compaction", operationId: "same-local-id", preCompactTokenCount: input }, at);
    }
    const earlier = f.message("root", { role: "user", time: { created: 5 } });
    f.part("root", earlier, { type: "text", text: "  first prompt  " });
    f.part("root", earlier, { type: "text", text: "   " });
    const transcript = await f.parity({ limit: 1, maxChars: 6 });
    expect(transcript.agents).toEqual([
      { id: "main" },
      { id: "child", parentId: "main", title: "Research" },
      { id: "empty", parentId: "main" },
      { id: "nested", parentId: "child" }
    ]);
    expect(
      transcript.events.filter((event) => event.kind === "user" && event.agentId === undefined).map((event) => event.ts)
    ).toEqual([30, 5, 5]);
    expect(transcript.events.map((event) => event.seq)).toEqual(transcript.events.map((_, index) => index));
    expect(new Set(transcript.events.map((event) => event.id)).size).toBe(transcript.events.length);
    expect(transcript.events.filter((event) => event.kind === "request").map((event) => event.agentId)).toEqual([
      "child",
      "nested",
      undefined
    ]);
    expect(foldTranscript(transcript)).toEqual({
      turns: 3,
      requests: 3,
      inputTokens: 60,
      outputTokens: 6,
      durationMs: 12,
      compactions: 3,
      subagents: 3,
      failedTools: 3,
      contextShape: [10, 20, 30]
    });
    expect(transcript.capabilities).toEqual(f.adapter.capabilities);
  });

  it.each([true, false])(
    "discovers orphans and respects softDeletes=%s for parents and children",
    async (softDeletes) => {
      const f = setup(false, { softDeletes });
      f.session("root");
      f.session("empty-parent", "");
      f.session("null-parent", null);
      f.session("child", "root");
      f.session("orphan", "missing");
      f.session("deleted", null, "", 5);
      f.session("deleted-child", "root", "", 5);
      f.session("orphan-of-deleted", "deleted");
      let total = 0;
      const items = [];
      for await (const item of f.adapter.discover(f.platform, f.root, {
        onTotal: (count) => {
          total = count;
        }
      })) {
        items.push(item);
      }
      const ids = items.map((item) => item.ref.sessionId ?? "").sort();
      expect(ids).toEqual(
        (softDeletes
          ? ["root", "empty-parent", "null-parent", "orphan", "orphan-of-deleted"]
          : ["root", "empty-parent", "null-parent", "orphan", "deleted"]
        ).sort()
      );
      expect(total).toBe(ids.length);
      const transcript = await f.parity();
      expect(transcript.agents.map((lane) => lane.id)).toEqual(
        softDeletes ? ["main", "child"] : ["main", "child", "deleted-child"]
      );
      const orphan = await f.adapter.load(f.platform, { ...f.ref, sessionId: "orphan" });
      expect(orphan.ok && orphan.value.agents).toEqual([{ id: "main" }]);
    }
  );

  it.each(["root", "nested"])("terminates parent cycles pointing back to %s", async (parent) => {
    const f = setup();
    f.session("root", parent);
    f.session("child", "root");
    f.session("nested", "child");
    const transcript = await f.parity();
    expect(transcript.agents.map((lane) => lane.id)).toEqual(["main", "child", "nested"]);
    expect(foldTranscript(transcript).subagents).toBe(2);
  });

  it("keeps old schemas readable without parent, deletion or sequence columns", async () => {
    const f = setup(true);
    f.session("root");
    const user = f.message("root", { role: "user" });
    f.part("root", user, { type: "compaction", auto: true });
    const transcript = await f.parity();
    expect(transcript.agents).toEqual([{ id: "main" }]);
    expect(transcript.capabilities).toEqual(["compaction"]);
    const items = [];
    for await (const item of f.adapter.discover(f.platform, f.root)) {
      items.push(item);
    }
    expect(items).toHaveLength(1);
  });

  it("aborts while traversing a child tree", async () => {
    const f = setup();
    f.session("root");
    f.session("child", "root");
    for (const method of ["load", "summarize"] as const) {
      const controller = new AbortController();
      const reason = new Error("stop child traversal");
      f.controls.beforeQuery = (sql) => {
        if (sql.includes("WHERE parent_id = ?")) {
          controller.abort(reason);
        }
      };
      await expect(f.adapter[method]!(f.platform, f.ref, { signal: controller.signal })).rejects.toBe(reason);
    }
  });

  it(
    "merges a child transcript larger than JavaScript's argument limit",
    async () => {
      const f = setup();
      f.session("root");
      f.session("child", "root");
      const message = f.message("child", { role: "assistant", time: { created: 1, completed: 2 } });
      f.db
        .prepare(`WITH RECURSIVE numbers(n) AS (VALUES(1) UNION ALL SELECT n + 1 FROM numbers WHERE n < 131072)
      INSERT INTO part (id, session_id, message_id, time_created, data)
      SELECT 'large-' || n, 'child', ?, n, '{"type":"text","text":"chunk"}' FROM numbers`)
        .run(message);
      const transcript = await f.parity();
      expect(transcript.events).toHaveLength(131073);
      expect(foldTranscript(transcript)).toEqual({
        turns: 0,
        requests: 1,
        durationMs: 1,
        subagents: 1,
        failedTools: 0
      });
    },
    SLOW_RUNNER_MS
  );

  it.each(["started", "retrying", "failed", "interrupted", "skipped", "future-status"])(
    "counts only a completed boundary beside a %s timeline attempt",
    async (timelineStatus) => {
      const f = setup();
      f.session("root");
      const message = f.message("root", { role: "assistant" });
      const rowid = f.part("root", message, {
        type: "compaction",
        operationId: "op",
        timelineStatus,
        preCompactTokenCount: 100
      });
      let transcript = await f.parity();
      expect(transcript.capabilities).toEqual(["requests"]);
      expect(transcript.events.filter((event) => event.kind === "compaction")).toHaveLength(0);
      expect(transcript.skipped).toContainEqual(
        expect.objectContaining({
          source: expect.objectContaining({ sqlite: { table: "part", column: "data", rowid } })
        })
      );
      const boundary = f.message("root", { role: "user" });
      f.part("root", boundary, {
        type: "compaction",
        operationId: "op",
        compactBoundary: { preCompactTokenCount: 80 }
      });
      transcript = await f.parity();
      expect(transcript.events.filter((event) => event.kind === "compaction").map((event) => event.payload)).toEqual([
        { preTokens: 80 }
      ]);
      expect(foldTranscript(transcript).compactions).toBe(1);
    }
  );

  it.each([
    [{ trigger: "reactive", auto: false }, "auto"],
    [{ compactBoundary: { trigger: "reactive" }, auto: false }, "auto"],
    [{ trigger: "future", auto: false }, undefined],
    [{ trigger: "future", auto: true }, undefined],
    [{ compactBoundary: { trigger: "future" }, trigger: "auto", auto: false }, undefined],
    [{ auto: false }, "manual"]
  ])("honors explicit compaction triggers: %j", async (fields, trigger) => {
    const f = setup();
    f.session("root");
    f.part("root", f.message("root", { role: "user" }), { type: "compaction", ...fields });
    const transcript = await f.parity();
    expect(transcript.events[0]?.payload.trigger).toBe(trigger);
  });

  it("keeps sequence order and tool pairing even with an empty child and backwards clocks", async () => {
    const f = setup();
    f.session("root");
    const user = f.message("root", { role: "user", time: { created: 50 } }, 50, 0);
    f.part("root", user, { type: "text", text: "first" }, 50);
    const request = f.message(
      "root",
      { role: "assistant", time: { created: 20, completed: 25 }, tokens: { input: 1 } },
      20,
      1
    );
    f.part(
      "root",
      request,
      { type: "tool", callID: "call", state: { status: "completed", output: "done", time: { end: 5 } } },
      30
    );
    const before = await f.parity();
    f.session("empty", "root");
    const after = await f.parity();
    expect(after.events).toEqual(before.events);
    expect(after.events.map((event) => event.kind)).toEqual(["user", "request", "tool_call", "tool_result"]);
    expect(after.events.map((event) => event.ts)).toEqual([50, 20, 30, 5]);
    expect(after.events.at(-1)?.payload.orphan).toBeUndefined();
  });

  it.each(["text", "tool", "compaction"])("uses retained %s times when merging subsequent requests", async (kind) => {
    const f = setup();
    f.session("root");
    f.session("child", "root");
    const first = f.message("root", { role: "assistant", time: { created: 10, completed: 11 }, tokens: { input: 1 } });
    const part =
      kind === "text"
        ? { type: "text", text: "later", time: { start: 90 } }
        : kind === "tool"
          ? { type: "tool", state: { status: "completed", time: { end: 90 } } }
          : { type: "compaction", timelineStatus: "completed", operationId: "op" };
    f.part("root", first, part, kind === "tool" ? 15 : 90);
    f.message("root", { role: "assistant", time: { created: 20, completed: 22 }, tokens: { input: 2 } });
    f.message("child", { role: "assistant", time: { created: 50, completed: 53 }, tokens: { input: 3 } });
    f.message("child", { role: "assistant", time: { created: 95, completed: 99 }, tokens: { input: 4 } });
    let transcript = await f.parity();
    expect(foldTranscript(transcript).contextShape).toEqual([1, 3, 2, 4]);
    if (kind === "compaction") {
      f.part(
        "root",
        f.message("root", { role: "user" }),
        { type: "compaction", operationId: "op", compactBoundary: {} },
        100
      );
      transcript = await f.parity();
      expect(foldTranscript(transcript).contextShape).toEqual([1, 2, 3, 4]);
    }
  });

  it("breaks equal effective timestamps by lane order without changing recorded times", async () => {
    const f = setup();
    f.session("root");
    f.session("child", "root");
    for (const [session, ts, input] of [
      ["root", 10, 1],
      ["root", 5, 2],
      ["child", 10, 3],
      ["child", 1, 4]
    ] as const) {
      f.message(session, { role: "assistant", time: { created: ts }, tokens: { input } });
    }
    const transcript = await f.parity();
    expect(foldTranscript(transcript).contextShape).toEqual([1, 2, 3, 4]);
    expect(transcript.events.map((event) => event.ts)).toEqual([10, 5, 10, 1]);
  });

  it.each([false, true])(
    "discovers one deterministic entry per rootless cycle (reverse insertion: %s)",
    async (reverse) => {
      const f = setup();
      const rows = [
        ["self", "self"],
        ["b", "a"],
        ["a", "b"],
        ["0-tail", "b"],
        ["root", null],
        ["child", "root"]
      ] as const;
      for (const [id, parent] of reverse ? [...rows].reverse() : rows) {
        f.session(id, parent);
      }
      let total = 0;
      const ids = [];
      for await (const item of f.adapter.discover(f.platform, f.root, {
        onTotal: (count) => {
          total = count;
        }
      })) {
        expect("error" in item).toBe(false);
        ids.push(item.ref.sessionId ?? "");
        const loaded = await f.adapter.load(f.platform, item.ref);
        expect(loaded.ok).toBe(true);
      }
      expect(ids.sort()).toEqual(["a", "root", "self"]);
      expect(total).toBe(3);
    }
  );

  it.each([0, 2])(
    "copies only the first %i main-lane prompts, capped at collection",
    async (limit) => {
      const f = setup();
      f.session("root");
      f.session("empty", "root");
      for (let index = 0; index < 50; index++) {
        const message = f.message("root", { role: "user", time: { created: 100 - index } });
        f.part("root", message, { type: "text", text: ` ${index}: ${"x".repeat(1000)} ` });
      }
      const copy = vi.spyOn(turns, "capPromptText");
      const prompts = { limit, maxChars: 4 };
      const summary = await f.adapter.summarize!(f.platform, f.ref, { prompts });
      expect(copy).toHaveBeenCalledTimes(limit);
      expect(summary.ok && summary.value.prompts).toEqual(limit === 0 ? [] : [{ text: "0: x" }, { text: "1: x" }]);
      copy.mockRestore();
      await f.parity(prompts);
    },
    SLOW_RUNNER_MS
  );

  it("uses provider task classification for discovery and each standalone branch's own child tree", async () => {
    const f = setup(false, { isSubagent: ({ taskType }) => taskType !== "branch" });
    f.db.exec("ALTER TABLE session ADD COLUMN task_type TEXT");
    f.session("root");
    f.session("child", "root");
    f.session("branch", "root");
    f.session("branch-child", "branch");
    f.db.prepare("UPDATE session SET task_type = ? WHERE id = ?").run("branch", "branch");
    for (const [id, input] of [
      ["root", 1],
      ["child", 2],
      ["branch", 100],
      ["branch-child", 200]
    ] as const) {
      f.message(id, { role: "assistant", time: { created: 1, completed: 2 }, tokens: { input } });
    }
    const transcript = await f.parity();
    expect(transcript.agents.map((lane) => lane.id)).toEqual(["main", "child"]);
    expect(foldTranscript(transcript)).toMatchObject({ requests: 2, inputTokens: 3, durationMs: 2 });
    const ids = [];
    for await (const item of f.adapter.discover(f.platform, f.root)) {
      ids.push(item.ref.sessionId ?? "");
    }
    expect(ids.sort()).toEqual(["branch", "root"]);
    const ref = { ...f.ref, sessionId: "branch" };
    const branch = await f.adapter.load(f.platform, ref);
    expect(branch.ok).toBe(true);
    if (branch.ok) {
      expect(branch.value.agents.map((lane) => lane.id)).toEqual(["main", "branch-child"]);
      expect(await f.adapter.summarize!(f.platform, ref)).toEqual({ ok: true, value: foldTranscript(branch.value) });
    }
  });
});
