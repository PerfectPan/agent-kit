import { isAgentKitError } from "@rivus/agent-kit-catalog";
import type { FileStat } from "@rivus/agent-kit-platform";
import {
  isUsageRecord,
  scanUsage,
  type ScanUsageOptions,
  type UsageRecord,
  type UsageScanState
} from "@rivus/agent-kit-sessions";
import { describe, expect, it } from "vitest";

import { createMemoryPlatform, type MemoryFile, type MemoryPlatform } from "../src/memory-platform.js";
import { readUsageHome } from "./support.js";

const tree = await readUsageHome("/u/me");
const text = (path: string): string => new TextDecoder().decode(tree[path]);
const T0 = Date.parse("2026-01-05T00:00:00.000Z");
const MINUTE = 60 * 1000;
/** Before every record of the fixture home. */
const since = Date.parse("2025-11-01T00:00:00.000Z");

const main = "/u/me/.claude/projects/-u-me-work/s-usage.jsonl";
const copy = "/u/me/.claude/projects/-u-me-work/s-usage/subagents/agent-copy.jsonl";
const pi = "/u/me/.pi/agent/sessions/--u-me-work--/2026-01-01T00-00-00-000Z_pi-1.jsonl";

/** The fixture home, last written an hour before `T0`, with a subagent file that starts with a copy of `req-1`. */
function home(): Record<string, MemoryFile> {
  const files: Record<string, MemoryFile> = {};
  for (const [path, content] of Object.entries(tree)) {
    files[path] = { content, mtimeMs: T0 - 60 * MINUTE };
  }
  const copied = text(main)
    .split("\n")
    .filter((line) => line.includes('"req-1"'))
    .join("\n");
  files[copy] = { content: `${copied}\n${claude("req-own", "copy", 2, 2)}\n`, mtimeMs: T0 - 60 * MINUTE };
  return files;
}

/** A Claude Code assistant record. */
function claude(requestId: string, agentId: string | undefined, input: number, output: number): string {
  return JSON.stringify({
    type: "assistant",
    sessionId: "s-usage",
    ...(agentId ? { agentId } : {}),
    requestId,
    timestamp: "2026-01-04T00:00:00.000Z",
    message: { id: `msg-${requestId}`, model: "claude-test", usage: { input_tokens: input, output_tokens: output } }
  });
}

/** A platform whose clock the test moves. */
function platformAt(files: Record<string, MemoryFile>): { platform: MemoryPlatform; at: (time: number) => void } {
  let now = T0;
  return { platform: createMemoryPlatform({ files, home: "/u/me", now: () => now }), at: (time) => (now = time) };
}

async function scan(
  platform: MemoryPlatform,
  options: ScanUsageOptions = { since },
  stop?: number
): Promise<{ records: UsageRecord[]; failures: string[]; state: UsageScanState }> {
  const run = scanUsage(platform, options);
  const records: UsageRecord[] = [];
  const failures: string[] = [];
  for await (const item of run) {
    if (isUsageRecord(item)) {
      records.push(item);
      if (records.length === stop) {
        break;
      }
    } else if (item.error._tag !== "RootMissing") {
      failures.push(`${item.path} ${item.error._tag}`);
    }
  }
  return { records, failures, state: JSON.parse(JSON.stringify(run.state)) as UsageScanState };
}

const keyOf = (record: UsageRecord) => `${record.agent} ${record.requestId ?? record.responseId ?? record.timestamp}`;
const paths = (state: UsageScanState) => Object.values(state.sources).map((source) => source.path);
const keys = (records: readonly UsageRecord[]) => records.map(keyOf).toSorted();
const tokens = (records: readonly UsageRecord[]) =>
  records.reduce((sum, record) => sum + (record.usage.totalTokens ?? 0), 0);

describe("scanUsage", () => {
  it("counts a request that two Claude Code files of a session hold once", async () => {
    const { platform } = platformAt(home());
    const { records, failures } = await scan(platform, { agents: ["claude-code"] });
    expect(failures).toEqual([]);
    expect(records.filter((record) => record.requestId === "req-1")).toHaveLength(1);
    expect(keys(records)).toEqual(
      ["msg-gw", "req-1", "req-2", "req-h", "req-old", "req-own", "req-side"].map((id) => `claude-code ${id}`)
    );
  });

  it("keeps a running session's last requests in its state until the file has been quiet for 30 minutes", async () => {
    const files = home();
    const { platform, at } = platformAt(files);
    const first = await scan(platform);
    await platform.fs.writeAtomic(main, `${text(main)}${claude("req-late", undefined, 5, 5)}\n`);
    const second = await scan(platform, { since, state: first.state });
    expect(second.records).toEqual([]);
    at(T0 + 31 * MINUTE);
    const third = await scan(platform, { since, state: second.state });
    expect(keys(third.records)).toEqual(["claude-code req-late"]);
    const fresh = await scan(platformAt(files).platform);
    expect(keys([...first.records, ...third.records])).toEqual(
      [...keys(fresh.records), "claude-code req-late"].toSorted()
    );
  });

  it("keeps the cursors of the sources a scan did not read: another agent, a loop left early, a failed listing", async () => {
    const { platform } = platformAt(home());
    const whole = await scan(platform);
    const codexOnly = await scan(platform, { agents: ["codex"], since, state: whole.state });
    expect(codexOnly.records).toEqual([]);
    expect(Object.keys(codexOnly.state.sources)).toEqual(Object.keys(whole.state.sources));
    expect((await scan(platform, { since, state: codexOnly.state })).records).toEqual([]);

    const fresh = platformAt(home()).platform;
    const head = await scan(fresh, { since }, 3);
    const rest = await scan(fresh, { since, state: head.state });
    expect(keys([...head.records, ...rest.records])).toEqual(keys(whole.records));

    const denied = platformAt(home()).platform;
    const first = await scan(denied);
    const list = denied.fs.list.bind(denied.fs);
    denied.fs.list = async (dir) => {
      if (dir.endsWith("/.codex/sessions/2026")) {
        throw Object.assign(new Error(`EACCES: ${dir}`), { code: "EACCES" });
      }
      return list(dir);
    };
    const failed = await scan(denied, { since, state: first.state });
    expect(failed.failures).toEqual(["/u/me/.codex/sessions/2026 ReadFailed"]);
    expect(Object.keys(failed.state.sources)).toEqual(Object.keys(first.state.sources));
  });

  it("drops the sources that were deleted or not modified since `since`, once a complete scan has run", async () => {
    const files = home();
    const { platform } = platformAt(files);
    const first = await scan(platform);
    await platform.fs.remove(pi);
    const archived = "/u/me/.codex/archived_sessions/rollout-2025-12-31T00-00-00-cx-archived.jsonl";
    const later = T0 - 30 * MINUTE;
    const next = await scan(platform, { since: later, state: first.state });
    expect(paths(next.state)).not.toContain(pi);
    expect(paths(next.state)).not.toContain(archived);
    // The memory platform dates a directory at its creation, so the older opencode layout's session stays listed.
    expect(Object.keys(next.state.sources)).toEqual(["opencode ses_legacy"]);
  });

  it("decides that a file is complete from the decode's own look at it, not from the listing", async () => {
    const files = home();
    const { platform, at } = platformAt(files);
    const first = await scan(platform);
    // The session writes a request's first record right after the listing saw the file quiet.
    const stat = platform.fs.stat.bind(platform.fs);
    let listed = false;
    platform.fs.stat = async (path, options): Promise<FileStat | undefined> => {
      const info = await stat(path, options);
      if (path === main && !listed) {
        listed = true;
        await platform.fs.writeAtomic(main, `${text(main)}${claude("req-new", undefined, 7, 3)}\n`);
      }
      return info;
    };
    at(T0 + 31 * MINUTE);
    const second = await scan(platform, { since, state: first.state });
    expect(second.records).toEqual([]);
    platform.fs.stat = stat;
    const appended = `${text(main)}${claude("req-new", undefined, 7, 3)}\n${claude("req-new", undefined, 7, 500)}\n`;
    await platform.fs.writeAtomic(main, appended);
    at(T0 + 62 * MINUTE);
    const third = await scan(platform, { since, state: second.state });
    expect(tokens(third.records)).toBe(507);
  });

  it("reads a rewritten file again after the records it read from it, so they count once", async () => {
    const files = home();
    const { platform } = platformAt(files);
    const first = await scan(platform, { agents: ["pi"], since });
    const extra = JSON.stringify({
      type: "message",
      id: "e9",
      timestamp: "2026-01-04T00:00:00.000Z",
      message: {
        role: "assistant",
        model: "model-test",
        usage: { input: 1, output: 1, totalTokens: 2 },
        responseId: "resp-9"
      }
    });
    await platform.fs.writeAtomic(pi, `${text(pi).slice(0, 40)}\n${text(pi)}${extra}\n`);
    const next = await scan(platform, { agents: ["pi"], since, state: first.state });
    expect(next.failures).toEqual([`${pi} SourceChanged`]);
    expect(keys(next.records)).toEqual(["pi e9"]);
  });

  it("counts a new record of a rewritten file that has the time of the latest one read", async () => {
    const files = home();
    const { platform } = platformAt(files);
    const first = await scan(platform, { agents: ["pi"], since });
    const same = JSON.stringify({
      type: "message",
      id: "e5",
      timestamp: "2026-01-01T00:00:03.000Z",
      message: { role: "assistant", model: "model-test", usage: { input: 1, output: 1, totalTokens: 2 } }
    });
    await platform.fs.writeAtomic(
      pi,
      `${text(pi).slice(0, 40)}
${text(pi)}${same}
`
    );
    const next = await scan(platform, { agents: ["pi"], since, state: first.state });
    expect(keys(next.records)).toEqual(["pi e5"]);

    // Records without a request key (an older Codex token_count) count by time, and by count at the latest time.
    const rollout = "/u/me/.codex/sessions/2026/01/01/rollout-2026-01-01T00-20-00-cx-edge.jsonl";
    const codex = await scan(platform, { agents: ["codex"], since });
    const again = text(rollout).trimEnd().split("\n").at(-1)!.replace('"input_tokens":1500', '"input_tokens":1700');
    await platform.fs.writeAtomic(rollout, `${text(rollout).slice(0, 30)}\n${text(rollout)}${again}\n`);
    const rewritten = await scan(platform, { agents: ["codex"], since, state: codex.state });
    expect(rewritten.records.map((record) => record.usage.inputTokens)).toEqual([200]);
  });

  it("keeps a session's request keys while it is idle, so a subagent file that copies them later counts nothing", async () => {
    const files = home();
    const { platform, at } = platformAt(files);
    at(T0 + 120 * MINUTE);
    const first = await scan(platform);
    const resumed = "/u/me/.claude/projects/-u-me-work/s-usage/subagents/agent-resumed.jsonl";
    const copied = text(main)
      .split("\n")
      .filter((line) => line.includes('"req-1"') || line.includes('"req-2"'))
      .join("\n");
    await platform.fs.writeAtomic(resumed, `${copied}\n`);
    at(T0 + 240 * MINUTE);
    const next = await scan(platform, { since, state: first.state });
    expect(next.records).toEqual([]);
  });

  it("follows a Codex rollout that archiving moved, without reading it again", async () => {
    const files = home();
    const { platform } = platformAt(files);
    const rollout = "/u/me/.codex/sessions/2026/01/01/rollout-2026-01-01T00-00-00-cx-totals.jsonl";
    const first = await scan(platform, { agents: ["codex"], since });
    const archived = "/u/me/.codex/archived_sessions/rollout-2026-01-01T00-00-00-cx-totals.jsonl";
    await platform.fs.rename(rollout, archived);
    const next = await scan(platform, { agents: ["codex"], since, state: first.state });
    expect(next.records).toEqual([]);
    expect(next.state.sources["codex rollout-2026-01-01T00-00-00-cx-totals.jsonl"]?.path).toBe(archived);
  });

  it("keeps an agent's sources while its root is missing, and reads nothing again when it is back", async () => {
    const files = home();
    const { platform } = platformAt(files);
    const first = await scan(platform, { agents: ["pi"], since });
    expect(first.records).not.toEqual([]);
    const away = "/u/me/elsewhere-pi";
    await platform.fs.rename("/u/me/.pi/agent/sessions", away);
    const missing = await scan(platform, { agents: ["pi"], since, state: first.state });
    expect(Object.keys(missing.state.sources)).toEqual(Object.keys(first.state.sources));
    await platform.fs.rename(away, "/u/me/.pi/agent/sessions");
    const back = await scan(platform, { agents: ["pi"], since, state: missing.state });
    expect(back.records).toEqual([]);
  });

  it("counts an older Gemini CLI chat once after it was migrated into a .jsonl file", async () => {
    const legacy = "/u/me/.gemini/tmp/projhash/chats/session-legacy.json";
    const { platform } = platformAt(home());
    const first = await scan(platform, { agents: ["gemini-cli"], since });
    expect(first.records.map(keyOf)).toContain("gemini-cli lg");
    const lines = [
      '{"sessionId":"gm-legacy","projectHash":"projhash","startTime":"2025-12-31T00:00:00.000Z"}',
      '{"id":"lg","timestamp":"2025-12-31T00:00:02.000Z","type":"gemini","model":"gemini-test","tokens":{"input":400,"output":60,"cached":100,"total":460}}',
      '{"id":"ln","timestamp":"2026-01-01T00:00:03.000Z","type":"gemini","model":"gemini-test","tokens":{"input":9,"output":1,"cached":0,"total":10}}'
    ];
    await platform.fs.writeAtomic(`${legacy}l`, `${lines.join("\n")}\n`);
    const second = await scan(platform, { agents: ["gemini-cli"], since, state: first.state });
    expect(second.records.map(keyOf)).toEqual(["gemini-cli ln"]);
  });

  it("needs `since` to continue from a state, keeps the window's request keys compact, and stops at `until`", async () => {
    const { platform } = platformAt(home());
    const first = await scan(platform);
    expect(Object.values(first.state.requests["claude-code"] ?? {}).join("")).toHaveLength(7 * 9);
    let thrown: unknown;
    try {
      scanUsage(platform, { state: first.state } as unknown as ScanUsageOptions);
    } catch (error) {
      thrown = error;
    }
    expect(isAgentKitError(thrown) && thrown.code).toBe("invalid-cursor");
    const later = await scan(platform, { since: Date.parse("2026-01-01T00:00:00.000Z"), state: first.state });
    // The days that ended before `since` are dropped: the request of 2025-12-01 goes, those of 2026-01-01 stay.
    expect(Object.values(later.state.requests["claude-code"] ?? {}).join("")).toHaveLength(6 * 9);
    const until = Date.parse("2026-01-01T00:00:04.000Z");
    const bounded = await scan(platformAt(home()).platform, { agents: ["claude-code"], until });
    expect(bounded.records.every((record) => record.timestamp < until)).toBe(true);
    expect(bounded.records.map(keyOf)).toContain("claude-code req-1");
  });

  it("counts records whose provider ids repeat across sessions, keyed by session and the agent's own id", async () => {
    const piSession = (id: string, entries: readonly string[]) =>
      [
        JSON.stringify({ type: "session", version: 3, id, timestamp: "2026-01-01T00:00:00.000Z", cwd: "/u/me/work" }),
        ...entries.map((entry, index) =>
          JSON.stringify({
            type: "message",
            id: entry,
            timestamp: `2026-01-01T00:00:0${index + 1}.000Z`,
            // A local model server numbers its responses, so another session repeats the ids.
            message: {
              role: "assistant",
              model: "local-model",
              usage: { input: 1, output: 1, totalTokens: 2 },
              responseId: `chatcmpl-${index + 1}`
            }
          })
        )
      ].join("\n") + "\n";
    const rollout = (id: string) =>
      [
        JSON.stringify({ timestamp: "2026-01-01T00:00:00.000Z", type: "session_meta", payload: { id } }),
        JSON.stringify({
          timestamp: "2026-01-01T00:00:01.000Z",
          type: "token_usage_record",
          payload: { response_id: "resp_7", usage: { input_tokens: 3, output_tokens: 1, total_tokens: 4 } }
        })
      ].join("\n") + "\n";
    const gateway = (sessionId: string) =>
      JSON.stringify({
        type: "assistant",
        sessionId,
        timestamp: "2026-01-01T00:00:01.000Z",
        message: { id: "msg_1", model: "gateway-model", usage: { input_tokens: 5, output_tokens: 1 } }
      }) + "\n";
    const old = T0 - 60 * MINUTE;
    const { platform } = platformAt({
      "/u/me/.pi/agent/sessions/--w--/2026-01-01T00-00-00-000Z_pi-a.jsonl": {
        content: piSession("pi-a", ["a1", "a2"]),
        mtimeMs: old
      },
      "/u/me/.pi/agent/sessions/--w--/2026-01-01T00-00-00-000Z_pi-b.jsonl": {
        content: piSession("pi-b", ["b1", "b2"]),
        mtimeMs: old
      },
      "/u/me/.codex/sessions/2026/01/01/rollout-2026-01-01T00-00-00-cx-a.jsonl": {
        content: rollout("cx-a"),
        mtimeMs: old
      },
      "/u/me/.codex/sessions/2026/01/01/rollout-2026-01-01T00-00-00-cx-b.jsonl": {
        content: rollout("cx-b"),
        mtimeMs: old
      },
      "/u/me/.claude/projects/-w/s-a.jsonl": { content: gateway("s-a"), mtimeMs: old },
      "/u/me/.claude/projects/-w/s-b.jsonl": { content: gateway("s-b"), mtimeMs: old }
    });
    const { records } = await scan(platform);
    expect(records.map((record) => `${record.agent} ${record.sessionId}`).toSorted()).toEqual([
      "claude-code s-a",
      "claude-code s-b",
      "codex cx-a",
      "codex cx-b",
      "pi pi-a",
      "pi pi-a",
      "pi pi-b",
      "pi pi-b"
    ]);
  });

  it("prunes per root: a missing archive does not keep deleted rollouts, and a source before `since` goes anyway", async () => {
    const files = Object.fromEntries(
      Object.entries(home()).filter(([path]) => !path.startsWith("/u/me/.codex/archived_sessions/"))
    );
    const { platform } = platformAt(files);
    const first = await scan(platform, { agents: ["codex"], since });
    const rollout = "/u/me/.codex/sessions/2026/01/01/rollout-2026-01-01T00-10-00-cx-fork.jsonl";
    await platform.fs.remove(rollout);
    const next = await scan(platform, { agents: ["codex"], since, state: first.state });
    expect(next.failures).toEqual([]);
    expect(paths(next.state)).not.toContain(rollout);
    expect(paths(next.state)).toHaveLength(2);

    const pis = await scan(platform, { agents: ["pi"], since });
    await platform.fs.rename("/u/me/.pi/agent/sessions", "/u/me/elsewhere-pi");
    const later = await scan(platform, { agents: ["pi"], since: T0, state: pis.state });
    expect(later.state.sources).toEqual({});
  });

  it("keeps a cursor per path for an id one scan finds at two paths, so neither reads the other's", async () => {
    const files = home();
    const elsewhere = "/u/me/.claude/projects/-u-me-old-work/s-usage.jsonl";
    files[elsewhere] = { content: text(main).split("\n").slice(0, 3).join("\n") + "\n", mtimeMs: T0 - 60 * MINUTE };
    const { platform } = platformAt(files);
    const first = await scan(platform, { agents: ["claude-code"], since });
    const next = await scan(platform, { agents: ["claude-code"], since, state: first.state });
    expect(next.failures).toEqual([]);
    expect(next.records).toEqual([]);
    expect(paths(next.state)).toContain(elsewhere);
  });
});
