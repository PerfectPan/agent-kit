import { cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { homeFromRule } from "@rivus/agent-kit-catalog/spi";
import { type SessionPlatform } from "@rivus/agent-kit-sessions/public";
import { foldTranscript, sessionPrompts, sessionRequestUsage, type Transcript } from "@rivus/agent-kit-sessions/spi";
import {
  createMemoryPlatform,
  oversizedSession,
  sessionAdapterConformance,
  usageDecoderConformance
} from "@rivus/agent-kit-testing/public";
import { afterAll, describe, expect, it } from "vite-plus/test";
import { nodeReadFs, readTree } from "../../../testing/test/support.js";
import { qoder } from "../src/identity.js";
import { qoderUsageTarget } from "../src/layout.js";
import { qoderUsageOf } from "../src/records.js";
import { qoderSessionAdapter } from "../src/sessions.js";
import { qoderUsageDecoder } from "../src/usage.js";

const fixtures = fileURLToPath(new URL("fixtures", import.meta.url));
const oversizedLine =
  '{"type":"system","uuid":"s0","timestamp":"2026-11-18T10:00:00.000Z","subtype":"info","content":"ok"}';

function describeConformance(name: string, setup: () => Promise<{ platform: SessionPlatform; root: string }>): void {
  describe(`qoder conformance (${name})`, async () => {
    const { platform, root } = await setup();
    const checks = sessionAdapterConformance(qoderSessionAdapter, {
      platform,
      root: `${root}/projects`,
      sessions: [
        {
          path: `${root}/projects/-u-me-work/s-1.jsonl`,
          records: 6,
          capabilities: ["requests", "usage", "reasoning", "compaction", "compactionTokens", "subagents"]
        },
        {
          path: `${root}/projects/-u-me-work/s-hooks.jsonl`,
          records: 9,
          capabilities: ["requests", "usage", "hooks"]
        }
      ],
      oversized: {
        root: `${root}/oversized/projects`,
        file: `${root}/oversized/projects/-u-me-work/s-big.jsonl`
      }
    });
    for (const { name: check, run } of checks) {
      it(`${check}`, async () => {
        await expect(run()).resolves.toBeUndefined();
      });
    }
  });
}

describeConformance("memory platform", async () => ({
  platform: createMemoryPlatform({
    files: {
      ...(await readTree(fixtures, "/qoder")),
      "/qoder/oversized/projects/-u-me-work/s-big.jsonl": oversizedSession(oversizedLine)
    },
    chunkSize: 1000
  }),
  root: "/qoder"
}));

const tempRoot = await mkdtemp(join(tmpdir(), "agent-kit-qoder-"));
afterAll(() => rm(tempRoot, { recursive: true, force: true }));

describeConformance("temp directory", async () => {
  await cp(fixtures, tempRoot, { recursive: true });
  await mkdir(join(tempRoot, "oversized/projects/-u-me-work"), { recursive: true });
  await writeFile(join(tempRoot, "oversized/projects/-u-me-work/s-big.jsonl"), oversizedSession(oversizedLine));
  return { platform: { fs: nodeReadFs() }, root: tempRoot };
});

const usagePlatform = createMemoryPlatform({
  files: await readTree(fixtures, "/qoder"),
  chunkSize: 1000
});
const usageFixtures = {
  platform: usagePlatform,
  home: homeFromRule("qoder", qoder.home, { home: "/qoder", env: { QODER_CONFIG_DIR: "/qoder" } }),
  sources: [
    {
      path: "/qoder/projects/-u-me-work/s-1.jsonl",
      records: 2
    },
    {
      path: "/qoder/projects/-u-me-work/s-hooks.jsonl",
      records: 2
    }
  ]
};
describe("qoder usage conformance", () => {
  for (const { name, run } of usageDecoderConformance(qoderUsageDecoder, usageFixtures)) {
    it(`${name}`, async () => {
      await expect(run()).resolves.toBeUndefined();
    });
  }
});

describe("qoder hook attachments and compaction metadata", () => {
  /** The lines whose events a compaction shadowed, in file order. */
  const shadowedLines = (transcript: Transcript): number[] => [
    ...new Set(transcript.events.filter((event) => event.shadowedBy !== undefined).map((event) => event.source.line))
  ];
  /** One JSONL record of an in-memory session. */
  const record = (
    sessionId: string,
    type: string,
    uuid: string,
    parentUuid: string | null,
    extra: Record<string, unknown>
  ): string => JSON.stringify({ type, uuid, parentUuid, sessionId, timestamp: "2026-11-18T12:00:00.000Z", ...extra });
  const load = async (lines: readonly string[], sessionId: string): Promise<Transcript | undefined> => {
    const path = `/qoder/projects/-u-me-work/${sessionId}.jsonl`;
    const result = await qoderSessionAdapter.load(createMemoryPlatform({ files: { [path]: lines.join("\n") } }), {
      agent: "qoder",
      path
    });
    expect(result.ok).toBe(true);
    return result.ok ? result.value : undefined;
  };

  it("turns hook_* attachments into hook events and skips the other attachments", async () => {
    const result = await qoderSessionAdapter.load(usagePlatform, {
      agent: "qoder",
      path: "/qoder/projects/-u-me-work/s-hooks.jsonl"
    });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    // An empty hook name (SessionStart) is left out, and `hook_output` names its event `hookEventName`.
    const hooks = result.value.events.filter((event) => event.kind === "hook");
    expect(hooks.map((event) => [event.source.line, event.payload])).toEqual([
      [1, { type: "hook_success", event: "SessionStart" }],
      [3, { type: "hook_output", event: "UserPromptSubmit" }],
      [
        6,
        {
          type: "hook_non_blocking_error",
          name: "PostToolUse:lint",
          event: "PostToolUse",
          exitCode: 127,
          durationMs: 12
        }
      ],
      [7, { type: "hook_system_message", name: "PostToolUse:notify", event: "PostToolUse" }]
    ]);
    // The output a hook gave the model stays on the event's original record.
    expect(hooks[1]?.original).toMatchObject({ attachment: { output: "Run pnpm build before replying." } });
    expect(result.value.skipped.map((skip) => [skip.reason, skip.source.line])).toEqual([
      ["attachment:queued_command", 9]
    ]);
  });

  it("carries a compaction's recorded trigger and token counts, and shadows the context it replaced", async () => {
    const result = await qoderSessionAdapter.load(usagePlatform, {
      agent: "qoder",
      path: "/qoder/projects/-u-me-work/s-1.jsonl"
    });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    const compaction = result.value.events.find((event) => event.kind === "compaction");
    expect(compaction?.payload).toEqual({ trigger: "auto", preTokens: 152000, postTokens: 31000 });
    // The boundary kept no messages: everything before it is replaced, the later sidechain prompt is not.
    expect(shadowedLines(result.value)).toEqual([1, 2, 3, 4]);
    expect(
      result.value.events
        .filter((event) => event.shadowedBy !== undefined)
        .every((event) => event.shadowedBy === compaction?.id)
    ).toBe(true);
    expect(result.value.events.filter((event) => event.source.line === 6).map((event) => event.shadowedBy)).toEqual([
      undefined
    ]);
  });

  it("keeps a compaction's preserved segment in the context and shadows what surrounds it", async () => {
    const transcript = await load(
      [
        record("s-preserved", "user", "p1", null, { message: { role: "user", content: "first" } }),
        record("s-preserved", "assistant", "p2", "p1", {
          requestId: "req_p1",
          message: { id: "m1", model: "claude-test", content: "first answer" }
        }),
        record("s-preserved", "user", "p3", "p2", { message: { role: "user", content: "second" } }),
        record("s-preserved", "assistant", "p4", "p3", {
          requestId: "req_p2",
          message: { id: "m2", model: "claude-test", content: "second answer" }
        }),
        record("s-preserved", "system", "c1", "p4", {
          subtype: "compact_boundary",
          content: "Conversation compacted",
          compactMetadata: {
            trigger: "auto",
            preTokens: 90000,
            postTokens: 12000,
            preservedSegment: { headUuid: "p3", anchorUuid: "p4", tailUuid: "p4", messageUuids: ["p3", "p4"] }
          }
        }),
        record("s-preserved", "user", "p5", "p4", { message: { role: "user", content: "third" } })
      ],
      "s-preserved"
    );
    const compaction = transcript?.events.find((event) => event.kind === "compaction");
    expect(compaction?.payload).toEqual({ trigger: "auto", preTokens: 90000, postTokens: 12000 });
    // Only the first turn is replaced; the kept segment and the prompt after the boundary stay in the context.
    expect(transcript && shadowedLines(transcript)).toEqual([1, 2]);
    expect(
      transcript?.events
        .filter((event) => [3, 4, 6].includes(event.source.line))
        .every((event) => event.shadowedBy === undefined)
    ).toBe(true);
  });

  it("leaves out a trigger outside the kit's two and maps the remaining hook outcomes", async () => {
    const transcript = await load(
      [
        record("s-edge", "attachment", "e1", null, {
          attachment: {
            type: "hook_blocking_error",
            hookName: "PreToolUse:guard",
            toolUseID: "toolu_e1",
            hookEvent: "PreToolUse",
            blockingError: { blockingError: "Denied by policy", command: "echo deny" }
          }
        }),
        record("s-edge", "attachment", "e2", "e1", {
          attachment: {
            type: "hook_permission_decision",
            decision: "deny",
            toolUseID: "toolu_e1",
            hookEvent: "PermissionRequest"
          }
        }),
        record("s-edge", "system", "e3", "e2", {
          subtype: "compact_boundary",
          content: "Conversation compacted",
          compactMetadata: { trigger: "reactive", preTokens: 130000 }
        })
      ],
      "s-edge"
    );
    expect(transcript?.events.map((event) => [event.kind, event.payload])).toEqual([
      ["hook", { type: "hook_blocking_error", name: "PreToolUse:guard", event: "PreToolUse" }],
      ["hook", { type: "hook_permission_decision", event: "PermissionRequest" }],
      ["compaction", { preTokens: 130000 }]
    ]);
  });
});

describe("qoder layout and usage edge cases", () => {
  it("parses main session and subagent paths and ignores stray jsonl files", () => {
    expect(qoderUsageTarget("/u/me/.qoder/projects/-u-me-work/s-1.jsonl")).toEqual({ sessionId: "s-1" });
    expect(qoderUsageTarget("/u/me/.qoder/projects/-u-me-work/s-1/subagents/agent-sub1.jsonl")).toEqual({
      sessionId: "s-1",
      agentLaneId: "sub1"
    });
    expect(qoderUsageTarget("C:\\Users\\me\\.qoder\\projects\\work\\s-2.jsonl")).toEqual({ sessionId: "s-2" });
    expect(qoderUsageTarget("/u/me/.qoder/logs/sessions/s-1.jsonl")).toBeUndefined();
    expect(qoderUsageTarget("/u/me/.qoder/projects/-u-me-work/s-1/subagents/journal.jsonl")).toBeUndefined();
    expect(qoderUsageTarget("/tmp/foo/subagents/agent-1.jsonl")).toBeUndefined();
    expect(qoderUsageTarget("/u/me/.qoder/projects/s-1/subagents/agent-1.jsonl")).toBeUndefined();
  });

  it("preserves absent token counts as undefined and sums cache counts into inputTokens", () => {
    expect(qoderUsageOf({ input_tokens: 100 })).toEqual({ inputTokens: 100 });
    expect(qoderUsageOf({ output_tokens: 50 })).toEqual({ outputTokens: 50 });
    expect(qoderUsageOf({ cache_read_input_tokens: 300 })).toEqual({ cacheReadTokens: 300 });
    expect(
      qoderUsageOf({
        input_tokens: 100,
        output_tokens: 20,
        cache_read_input_tokens: 300,
        cache_creation_input_tokens: 0,
        cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 50 }
      })
    ).toEqual({
      inputTokens: 450,
      outputTokens: 20,
      cacheReadTokens: 300,
      cacheWriteTokens: 50,
      cacheWrite1hTokens: 50,
      totalTokens: 470
    });
  });

  it("merges streamed assistant fragments, handles multi-block/sidechain prompts, and matches foldTranscript", async () => {
    const path = "/qoder/projects/-u-me-work/s-stream.jsonl";
    const lines = [
      "not-json",
      JSON.stringify({ missingType: true }),
      // Multi-block user prompt starting with whitespace-only text block.
      JSON.stringify({
        type: "user",
        timestamp: "2026-11-18T10:00:00Z",
        message: {
          role: "user",
          content: [
            { type: "text", text: "   " },
            { type: "text", text: "First" },
            { type: "text", text: "Second" }
          ]
        }
      }),
      // Meta and compactSummary user records are not prompts.
      JSON.stringify({ type: "user", isMeta: true, message: { role: "user", content: "meta" } }),
      JSON.stringify({ type: "user", isCompactSummary: true, message: { role: "user", content: "summary" } }),
      // Streamed assistant fragments sharing requestId/message.id: 1st has partial usage, 2nd has final usage.
      JSON.stringify({
        type: "assistant",
        timestamp: "2026-11-18T10:00:01Z",
        requestId: "req_s1",
        message: {
          id: "msg_s1",
          model: "claude-test",
          stop_reason: null,
          usage: { input_tokens: 100, output_tokens: 5 },
          content: [{ type: "thinking", thinking: "hmm" }]
        }
      }),
      JSON.stringify({
        type: "assistant",
        timestamp: "2026-11-18T10:00:02Z",
        requestId: "req_s1",
        message: {
          id: "msg_s1",
          model: "claude-test",
          stop_reason: "tool_use",
          usage: { input_tokens: 100, output_tokens: 45 },
          content: [{ type: "tool_use", id: "tc_1", name: "Bash", input: { command: "false" } }]
        }
      }),
      JSON.stringify({
        type: "user",
        timestamp: "2026-11-18T10:00:03Z",
        message: {
          role: "user",
          content: [{ type: "tool_result", tool_use_id: "tc_1", content: "fail", is_error: true }]
        }
      }),
      // Sidechain prompt must not count as a main-lane turn or prompt, and registers its lane.
      JSON.stringify({
        type: "user",
        isSidechain: true,
        agentId: "sub_1",
        timestamp: "2026-11-18T10:00:04Z",
        message: { role: "user", content: "subagent task" }
      })
    ].join("\n");

    const platform = createMemoryPlatform({ files: { [path]: lines } });
    const ref = { agent: "qoder" as const, path, sessionId: "s-stream" };
    const loaded = await qoderSessionAdapter.load(platform, ref);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) {
      return;
    }
    const summarized = await qoderSessionAdapter.summarize!(platform, ref, { prompts: { limit: 10, maxChars: 200 } });
    expect(summarized.ok).toBe(true);
    if (!summarized.ok) {
      return;
    }

    // Streamed fragments merge into one request keeping final outputTokens=45 and linking both content events.
    const requests = loaded.value.events.filter((event) => event.kind === "request");
    expect(requests).toHaveLength(1);
    expect(requests[0]?.payload.usage).toEqual({ inputTokens: 100, outputTokens: 45, totalTokens: 145 });
    const toolCall = loaded.value.events.find((event) => event.kind === "tool_call");
    expect(toolCall?.requestId).toBe("req_s1");
    expect(loaded.value.agents.map((lane) => lane.id)).toEqual(["qoder", "sub_1"]);

    // summarize matches foldTranscript + sessionPrompts on multi-block prompt and sidechain lane.
    const folded = foldTranscript(loaded.value);
    const { prompts: summaryPrompts, ...summaryRest } = summarized.value;
    expect(summaryRest).toEqual({ ...folded, requestUsage: sessionRequestUsage(loaded.value) });
    expect(summaryPrompts).toEqual(sessionPrompts(loaded.value, { limit: 10, maxChars: 200 }));
    expect(summaryPrompts).toEqual([{ text: "First\n\nSecond" }]);

    // Usage decoder also merges the two streamed fragments into one record with outputTokens=45.
    const usageRecords = [];
    for await (const item of qoderUsageDecoder.decode(platform, { path }, { final: true })) {
      if ("usage" in item) {
        usageRecords.push(item);
      }
    }
    expect(usageRecords).toHaveLength(1);
    expect(usageRecords[0]?.usage).toEqual({ inputTokens: 100, outputTokens: 45, totalTokens: 145 });
  });

  it("rejects Claude Code paths and non-JSONL files in detect()", async () => {
    const claudePath = "/u/me/.claude/projects/-u-me-work/s-1.jsonl";
    const nonJsonPath = "/u/me/.qoder/projects/-u-me-work/bad.jsonl";
    const platform = createMemoryPlatform({
      files: {
        [claudePath]: JSON.stringify({ type: "user", message: { role: "user", content: "hi" } }),
        [nonJsonPath]: "not json at all\n"
      }
    });
    expect(await qoderSessionAdapter.detect(platform, { agent: "qoder", path: claudePath })).toBe(false);
    expect(await qoderSessionAdapter.detect(platform, { agent: "qoder", path: nonJsonPath })).toBe(false);
  });

  it("buffers open streamed requests across non-final incremental cursor resumes", async () => {
    const path = "/qoder/projects/-u-me-work/s-inc.jsonl";
    const part1 = `${JSON.stringify({
      type: "assistant",
      timestamp: "2026-11-18T10:00:01Z",
      requestId: "req_inc",
      message: { id: "msg_inc", model: "claude-test", usage: { input_tokens: 100, output_tokens: 5 } }
    })}\n`;
    const part2 = `${JSON.stringify({
      type: "assistant",
      timestamp: "2026-11-18T10:00:02Z",
      requestId: "req_inc",
      message: { id: "msg_inc", model: "claude-test", usage: { input_tokens: 100, output_tokens: 45 } }
    })}\n`;

    const now = Date.parse("2026-11-18T10:00:02Z");
    const platform1 = createMemoryPlatform({ files: { [path]: { content: part1, mtimeMs: now } }, now: () => now });
    const stream1 = qoderUsageDecoder.decode(platform1, { path }, { final: false });
    const firstPass = [];
    for await (const item of stream1) {
      if ("usage" in item) {
        firstPass.push(item);
      }
    }
    const cursor1 = stream1.cursor;
    expect(firstPass).toHaveLength(0);

    const platform2 = createMemoryPlatform({
      files: { [path]: { content: part1 + part2, mtimeMs: now } },
      now: () => now
    });
    const stream2 = qoderUsageDecoder.decode(platform2, { path }, { from: cursor1, final: true });
    const secondPass = [];
    for await (const item of stream2) {
      if ("usage" in item) {
        secondPass.push(item);
      }
    }
    expect(secondPass).toHaveLength(1);
    expect(secondPass[0]?.usage).toEqual({ inputTokens: 100, outputTokens: 45, totalTokens: 145 });
  });

  it("keeps main-lane streaming fragments open when a sidechain request interleaves", async () => {
    const path = "/qoder/projects/-u-me-work/s-interleave.jsonl";
    const lines = [
      JSON.stringify({
        type: "assistant",
        timestamp: "2026-11-18T10:00:01Z",
        requestId: "req_main",
        message: { id: "msg_main", model: "claude-test", usage: { input_tokens: 100, output_tokens: 5 } }
      }),
      JSON.stringify({
        type: "assistant",
        timestamp: "2026-11-18T10:00:02Z",
        isSidechain: true,
        agentId: "sub_1",
        requestId: "req_sub",
        message: { id: "msg_sub", model: "claude-test", usage: { input_tokens: 20, output_tokens: 10 } }
      }),
      JSON.stringify({
        type: "assistant",
        timestamp: "2026-11-18T10:00:03Z",
        requestId: "req_main",
        message: { id: "msg_main", model: "claude-test", usage: { input_tokens: 100, output_tokens: 45 } }
      })
    ].join("\n");
    const platform = createMemoryPlatform({ files: { [path]: lines } });
    const records = [];
    for await (const item of qoderUsageDecoder.decode(platform, { path }, { final: true })) {
      if ("usage" in item) {
        records.push(item);
      }
    }
    expect(records).toHaveLength(2);
    const main = records.find((r) => r.requestId === "req_main");
    const sub = records.find((r) => r.requestId === "req_sub");
    expect(main?.usage).toEqual({ inputTokens: 100, outputTokens: 45, totalTokens: 145 });
    expect(sub?.agentLaneId).toBe("sub_1");
    expect(sub?.usage).toEqual({ inputTokens: 20, outputTokens: 10, totalTokens: 30 });
  });

  it("scans subagent transcripts as usage sources and ignores unrelated files", async () => {
    const mainPath = "/qoder/projects/-u-me-work/s-1.jsonl";
    const subPath = "/qoder/projects/-u-me-work/s-1/subagents/agent-helper.jsonl";
    const strayPath = "/qoder/projects/-u-me-work/s-1/subagents/journal.jsonl";
    const line = JSON.stringify({
      type: "assistant",
      requestId: "r1",
      message: { id: "m1", model: "claude-test", usage: { input_tokens: 10, output_tokens: 5 } }
    });
    const platform = createMemoryPlatform({ files: { [mainPath]: line, [subPath]: line, [strayPath]: line } });
    const home = homeFromRule("qoder", qoder.home, { home: "/qoder", env: { QODER_CONFIG_DIR: "/qoder" } });
    const paths: string[] = [];
    for await (const item of qoderUsageDecoder.sources(platform, home)) {
      if ("path" in item && !("error" in item)) {
        paths.push(item.path);
      }
    }
    expect(paths.toSorted()).toEqual([mainPath, subPath]);
  });
});
