import { fileURLToPath } from "node:url";

import type { CodingAgentId } from "@rivus/agent-kit-catalog";
import {
  addUsage,
  decodeUsage,
  type DecodeUsageOptions,
  isUsageRecord,
  loadTranscript,
  type RequestPayload,
  type Usage,
  type UsageCursor,
  type UsagePlatform,
  type UsageRecord
} from "@rivus/agent-kit-sessions";
import { describe, expect, it } from "vite-plus/test";

import { createMemoryPlatform, type MemoryPlatform } from "../src/memory-platform.js";
import { claudeCodeSessions, codexSessions, grokSessions, readTree, readUsageHome } from "./support.js";

// The invariant every usage decoder keeps: a file decoded in steps while it grows (a cursor stored between the steps,
// as JSON) gives the records one decode of the whole file gives, and those records sum to the request usage of the
// session's transcript.

const fixtures = (path: string) => fileURLToPath(new URL(`fixtures/${path}`, import.meta.url));
const tree = {
  ...(await readTree(fixtures("claude-code"), "/fx/claude-code")),
  ...(await readTree(fixtures("codex"), "/fx/codex")),
  ...(await readTree(fixtures("grok"), "/fx/grok")),
  ...(await readUsageHome("/u/me"))
};

async function decodeAll(
  platform: UsagePlatform,
  agent: CodingAgentId,
  path: string,
  options: DecodeUsageOptions = {}
): Promise<{ records: UsageRecord[]; cursor: UsageCursor | undefined }> {
  const stream = decodeUsage(platform, agent, { path }, options);
  const records: UsageRecord[] = [];
  for await (const item of stream) {
    if (!isUsageRecord(item)) {
      throw new Error(`${path}: ${JSON.stringify(item.error)}`);
    }
    records.push(item);
  }
  const cursor = stream.cursor === undefined ? undefined : (JSON.parse(JSON.stringify(stream.cursor)) as UsageCursor);
  return { records, cursor };
}

/** Byte offsets to cut a file at: after every line, and in the middle of every line. */
function cuts(bytes: Uint8Array): number[] {
  const out: number[] = [];
  let start = 0;
  for (let at = bytes.indexOf(0x0a); at >= 0; at = bytes.indexOf(0x0a, start)) {
    out.push(start + Math.floor((at - start) / 2), at + 1);
    start = at + 1;
  }
  return out;
}

/** Decodes `path` while it grows to its full content, then once more with `final`. */
async function grown(platform: MemoryPlatform, agent: CodingAgentId, path: string, full: Uint8Array) {
  const records: UsageRecord[] = [];
  let cursor: UsageCursor | undefined;
  for (const cut of [...cuts(full), full.length]) {
    await platform.fs.writeAtomic(path, full.subarray(0, cut));
    const step = await decodeAll(platform, agent, path, {
      ...(cursor ? { from: cursor } : {}),
      ...(cut === full.length ? { final: true } : {})
    });
    records.push(...step.records);
    cursor = step.cursor;
  }
  return records;
}

const sessions: readonly (readonly [CodingAgentId, string, readonly string[]])[] = [
  ...claudeCodeSessions("/fx/claude-code/conformance").map(
    (session) => ["claude-code", session.path, session.files ?? [session.path]] as const
  ),
  [
    "claude-code",
    "/u/me/.claude/projects/-u-me-work/s-usage.jsonl",
    [
      "/u/me/.claude/projects/-u-me-work/s-usage.jsonl",
      "/u/me/.claude/projects/-u-me-work/s-usage/subagents/agent-helper.jsonl"
    ]
  ],
  ...codexSessions("/fx/codex/conformance").map((session) => ["codex", session.path, [session.path]] as const),
  ...Object.keys(tree)
    .filter((path) => path.startsWith("/u/me/.codex/"))
    .map((path) => ["codex", path, [path]] as const),
  ...grokSessions("/fx/grok/conformance").map((session) => ["grok", session.path, [session.path]] as const),
  [
    "grok",
    "/u/me/.grok/sessions/%2Fu%2Fme%2Fwork/gk-usage/updates.jsonl",
    ["/u/me/.grok/sessions/%2Fu%2Fme%2Fwork/gk-usage/updates.jsonl"]
  ]
];

/** JSONL files of agents without transcripts. */
const usageOnly: readonly (readonly [CodingAgentId, string])[] = Object.keys(tree)
  .filter((path) => path.endsWith(".jsonl") && (path.startsWith("/u/me/.gemini/") || path.startsWith("/u/me/.pi/")))
  .map((path) => [path.startsWith("/u/me/.pi/") ? "pi" : "gemini-cli", path] as const);

describe("usage decoded while a file grows equals one decode of the whole file", () => {
  const files = [...sessions.flatMap(([agent, , paths]) => paths.map((path) => [agent, path] as const)), ...usageOnly];
  it.each(files)("%s %s", async (agent, path) => {
    const platform = createMemoryPlatform({ files: tree, home: "/u/me", chunkSize: 37 });
    const whole = await decodeAll(platform, agent, path, { final: true });
    expect(await grown(platform, agent, path, tree[path]!)).toEqual(whole.records);
  });

  it("opencode's older layout, as message files are added", async () => {
    const dir = "/u/me/.local/share/opencode/storage/message/ses_legacy";
    const names = Object.keys(tree)
      .filter((path) => path.startsWith(`${dir}/`))
      .toSorted();
    const whole = await decodeAll(createMemoryPlatform({ files: tree }), "opencode", dir, {
      final: true
    });
    const platform = createMemoryPlatform({ files: {} });
    const records: UsageRecord[] = [];
    let cursor: UsageCursor | undefined;
    for (const name of names) {
      await platform.fs.writeAtomic(name, tree[name]!);
      const step = await decodeAll(platform, "opencode", dir, cursor ? { from: cursor } : {});
      records.push(...step.records);
      cursor = step.cursor;
    }
    expect(records).toEqual(whole.records);
  });
});

describe("decodeUsage and loadTranscript agree", () => {
  const platform = createMemoryPlatform({ files: tree, home: "/u/me" });
  it.each(sessions)("%s %s", async (agent, path, files) => {
    const transcript = await loadTranscript(platform, { agent, path });
    if (!transcript.ok) {
      throw new Error(`${path}: ${transcript.error._tag}`);
    }
    const expected = transcript.value.events
      .filter((event) => event.kind === "request")
      .reduce<Usage>((sum, event) => addUsage(sum, (event.payload as RequestPayload).usage ?? {}), {});
    let decoded: Usage = {};
    for (const file of files) {
      for (const record of (await decodeAll(platform, agent, file, { final: true })).records) {
        decoded = addUsage(decoded, record.usage);
      }
    }
    expect(decoded).toEqual(expected);
  });
});

/** JSONL text of Claude Code assistant records: [request id, input tokens, output tokens]. */
function claudeLines(records: readonly (readonly [string, number, number])[]): string {
  return records
    .map(([requestId, input, output], index) =>
      JSON.stringify({
        type: "assistant",
        requestId,
        sessionId: "s",
        timestamp: new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString(),
        message: {
          id: `msg-${requestId}`,
          model: "claude-test",
          usage: { input_tokens: input, output_tokens: output }
        }
      })
    )
    .map((line) => `${line}\n`)
    .join("");
}

const total = (records: readonly UsageRecord[]) =>
  records.reduce((sum, record) => sum + (record.usage.totalTokens ?? 0), 0);

describe("claude-code requests across cursors", () => {
  const path = "/u/me/.claude/projects/p/s.jsonl";

  it("reports a request with the usage of its last record when the records arrive in two decodes", async () => {
    const text = claudeLines([
      ["req-a", 7, 3],
      ["req-a", 7, 500]
    ]);
    const platform = createMemoryPlatform({
      files: { [path]: text.slice(0, text.indexOf("\n") + 1) }
    });
    const first = await decodeAll(platform, "claude-code", path);
    await platform.fs.writeAtomic(path, text);
    const next = await decodeAll(platform, "claude-code", path, {
      ...(first.cursor ? { from: first.cursor } : {}),
      final: true
    });
    expect(total([...first.records, ...next.records])).toBe(507);
  });

  it("keeps interleaved requests of one lane open, each with its largest usage", async () => {
    const platform = createMemoryPlatform({
      files: {
        [path]: claudeLines([
          ["req-a", 100, 0],
          ["req-b", 300, 0],
          ["req-a", 400, 0]
        ])
      }
    });
    expect(total((await decodeAll(platform, "claude-code", path, { final: true })).records)).toBe(700);
  });

  it("drops a later copy of a reported request, like the translator, within the remembered keys", async () => {
    const others = Array.from({ length: 10 }, (_, index) => [`req-${index}`, 1, 0] as const);
    const platform = createMemoryPlatform({
      files: { [path]: claudeLines([["req-copied", 1, 0], ...others, ["req-copied", 1, 0]]) }
    });
    const records = (await decodeAll(platform, "claude-code", path, { final: true })).records;
    expect(records).toHaveLength(11);
    const transcript = await loadTranscript(platform, { agent: "claude-code", path });
    expect(transcript.ok && transcript.value.events.filter((event) => event.kind === "request")).toHaveLength(11);
  });
});

describe("codex fork replay across cursors", () => {
  it("keeps the first usage record undecided until the next one, also across a cursor", async () => {
    const path = "/u/me/.codex/sessions/r.jsonl";
    const count = (ms: number, input: number) =>
      JSON.stringify({
        timestamp: new Date(Date.UTC(2026, 0, 1) + ms).toISOString(),
        type: "event_msg",
        payload: {
          type: "token_count",
          info: { last_token_usage: { input_tokens: input, output_tokens: 1 } }
        }
      });
    const meta = JSON.stringify({
      timestamp: new Date(Date.UTC(2026, 0, 1)).toISOString(),
      type: "session_meta",
      payload: { id: "b", forked_from_id: "a" }
    });
    const lines = [meta, count(100, 1), count(200, 2), count(1500, 3)].map((line) => `${line}\n`);
    const platform = createMemoryPlatform({ files: { [path]: lines.slice(0, 2).join("") } });
    const first = await decodeAll(platform, "codex", path);
    expect(first.records).toEqual([]);
    await platform.fs.writeAtomic(path, lines.join(""));
    const next = await decodeAll(platform, "codex", path, {
      ...(first.cursor ? { from: first.cursor } : {}),
      final: true
    });
    expect(next.records.map((record) => record.usage.inputTokens)).toEqual([3]);
  });
});
