import { fileURLToPath } from "node:url";

import { homeFromRule } from "@rivus/agent-kit-catalog/spi";
import { readHookEvent } from "@rivus/agent-kit-harness/public/events";
import {
  foldTranscript,
  isSessionHead,
  sessionPrompts,
  sessionRequestUsage,
  summarizeSession,
  type SessionPlatform
} from "@rivus/agent-kit-sessions/public";
import { createMemoryPlatform } from "@rivus/agent-kit-testing/public";
import { describe, expect, it } from "vite-plus/test";
import { readTree } from "../../../testing/test/support.js";
import { relayedMessage, subagentCreated } from "./fixtures/subagents.js";
import { agyHookDialect } from "../src/hooks.js";
import { agy } from "../src/identity.js";
import { agyInstallAdapter } from "../src/install.js";
import { agyConversationLocation, agySessionIdFromPath } from "../src/layout.js";
import {
  agyRelayedMessageSender,
  agyStepOf,
  agySubagentRoleOf,
  agySubagentSpawnedOf,
  agyUsageOf
} from "../src/records.js";
import { agySessionAdapter } from "../src/sessions.js";
import { agyIsSpawnedConversation } from "../src/sessions/subagents.js";
import { agyUsageDecoder } from "../src/usage.js";

const fixtures = fileURLToPath(new URL("fixtures", import.meta.url));
const LOGS = ".system_generated/logs";

describe("agy records and layout edge cases", () => {
  it("preserves absent token counts as undefined and keeps explicit cache_read_tokens: 0", () => {
    expect(agyUsageOf({ type: "PLANNER_RESPONSE", input_tokens: 100 })).toEqual({ inputTokens: 100 });
    expect(agyUsageOf({ type: "PLANNER_RESPONSE", output_tokens: 50 })).toEqual({ outputTokens: 50 });
    expect(
      agyUsageOf({ type: "PLANNER_RESPONSE", input_tokens: 100, cache_read_tokens: 0, output_tokens: 20 })
    ).toEqual({ inputTokens: 100, cacheReadTokens: 0, outputTokens: 20, totalTokens: 120 });
    expect(
      agyUsageOf({ type: "PLANNER_RESPONSE", input_tokens: 200, cache_read_tokens: 300, output_tokens: 50 })
    ).toEqual({ inputTokens: 500, cacheReadTokens: 300, outputTokens: 50, totalTokens: 550 });
    expect(agyUsageOf({ type: "USER_INPUT" })).toBeUndefined();
  });

  it("parses tool_calls per element so one malformed item does not drop valid calls", () => {
    const step = agyStepOf({
      type: "PLANNER_RESPONSE",
      tool_calls: [{ name: "read_file", args: { Path: "/a" } }, { bad: true }, { name: "run_command" }]
    });
    expect(step?.tool_calls).toEqual([{ name: "read_file", args: { Path: "/a" } }, { name: "run_command" }]);
  });

  it("extracts conversation ids from both POSIX and Windows paths", () => {
    expect(
      agySessionIdFromPath("/u/me/.gemini/antigravity-cli/brain/conv-1/.system_generated/logs/transcript.jsonl")
    ).toBe("conv-1");
    expect(
      agySessionIdFromPath(
        "C:\\Users\\me\\.gemini\\antigravity-cli\\brain\\conv-2\\.system_generated\\logs\\transcript.jsonl"
      )
    ).toBe("conv-2");
  });

  it("locates the brain root and conversation of a transcript path on either separator", () => {
    expect(
      agyConversationLocation("/u/me/.gemini/antigravity-cli/brain/conv-1/.system_generated/logs/transcript_full.jsonl")
    ).toEqual({ brainRoot: "/u/me/.gemini/antigravity-cli/brain", conversationId: "conv-1" });
    expect(
      agyConversationLocation(
        "C:\\Users\\me\\.gemini\\antigravity-cli\\brain\\conv-2\\.system_generated\\logs\\transcript.jsonl"
      )
    ).toEqual({ brainRoot: "C:\\Users\\me\\.gemini\\antigravity-cli\\brain", conversationId: "conv-2" });
    expect(
      agyConversationLocation(
        "C:\\Users\\me\\tmp/antigravity-cli/brain/conv-3/.system_generated/logs/transcript_full.jsonl"
      )
    ).toEqual({ brainRoot: "C:\\Users\\me\\tmp/antigravity-cli/brain", conversationId: "conv-3" });
    // A transcript outside the layout, or one whose conversation sits at the file system root, locates no brain
    // root: its spawns cannot be followed.
    expect(agyConversationLocation("/u/me/elsewhere/transcript.jsonl")).toBeUndefined();
    expect(agyConversationLocation("/conv/.system_generated/logs/transcript.jsonl")).toBeUndefined();
  });

  it("reads the conversation an invoke_subagent result names out of its free-form text", () => {
    const text = subagentCreated("sub-1");
    expect(agySubagentSpawnedOf(text)).toBe("sub-1");
    // Braces inside the object's strings do not end it, and text follows the object.
    expect(
      agySubagentSpawnedOf(
        'Created the following subagent:\n{"conversationId": "sub-2", "note": "a } brace and \\" quote", "more": {"a": 1}}\nDone'
      )
    ).toBe("sub-2");
    // No object, a truncated object, or an id that is not one path segment names no conversation.
    expect(agySubagentSpawnedOf("Created At: 2026-11-18T10:00:00Z")).toBeUndefined();
    expect(agySubagentSpawnedOf('Created the following subagent:\n{"conversationId": "sub-3"')).toBeUndefined();
    expect(agySubagentSpawnedOf('Created the following subagent:\n{"conversationId": "../escape"}')).toBeUndefined();
    expect(agySubagentSpawnedOf('Created the following subagent:\n{"conversationId": ""}')).toBeUndefined();
    expect(agySubagentSpawnedOf('Created the following subagent:\n{"logAbsoluteUri": "file:///x"}')).toBeUndefined();
    expect(agySubagentRoleOf({ Prompt: "p", Role: "Reviewer", TypeName: "research" })).toBe("Reviewer");
    expect(agySubagentRoleOf({ Prompt: "p", TypeName: "research" })).toBeUndefined();
    expect(agySubagentRoleOf("not an object")).toBeUndefined();
  });

  it("tells a spawned conversation by the relayed message that is its first record", () => {
    const relayed = { type: "SYSTEM_MESSAGE", content: relayedMessage("conv-1", "Summarize the failures.") };
    expect(agyRelayedMessageSender(relayed.content)).toBe("conv-1");
    expect(agyIsSpawnedConversation(relayed, "sub-1")).toBe(true);
    // A conversation relaying its own notice, a plain system message and a user record start sessions.
    expect(
      agyIsSpawnedConversation({ type: "SYSTEM_MESSAGE", content: relayedMessage("conv-1", "Task 7 done") }, "conv-1")
    ).toBe(false);
    expect(agyIsSpawnedConversation({ type: "SYSTEM_MESSAGE", content: "Session initialized." }, "conv-1")).toBe(false);
    expect(agyIsSpawnedConversation({ type: "USER_INPUT", content: relayedMessage("conv-1", "x") }, "sub-1")).toBe(
      false
    );
    expect(agyIsSpawnedConversation(undefined, "conv-1")).toBe(false);
  });
});

describe("agy subagent conversations", () => {
  const ref = { agent: "agy" as const, path: `/agy/antigravity-cli/brain/conv-1/${LOGS}/transcript_full.jsonl` };
  const providers = { sessions: { agy: agySessionAdapter }, identity: { agy } };

  it("attaches the spawned conversation as a lane after the root lane and lists no session for it", async () => {
    const platform = createMemoryPlatform({ files: await readTree(fixtures, "/agy") });
    const listed = [];
    for await (const item of agySessionAdapter.discover(platform, "/agy/antigravity-cli/brain")) {
      if (isSessionHead(item)) {
        listed.push(item.ref.sessionId);
      }
    }
    expect(listed).toEqual(["conv-1"]);

    const loaded = await agySessionAdapter.load(platform, ref);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) {
      return;
    }
    const { agents: lanes, events, capabilities } = loaded.value;
    const spawn = events.find((event) => event.kind === "tool_call" && event.payload.name === "invoke_subagent");
    expect(lanes).toEqual([
      { id: "agy" },
      { id: "sub-1", parentId: "agy", spawnEventId: spawn?.id, title: "Test Summarizer" }
    ]);
    expect(spawn?.id).toBe("transcript_full.jsonl:5:1");
    expect(capabilities).toContain("subagents");

    // The subagent lane's events follow the root lane's, carry their lane and ids prefixed with it, and keep the
    // file and line they came from.
    const rootCount = events.filter((event) => event.agentId === undefined).length;
    expect(rootCount).toBeGreaterThan(0);
    const laneEvents = events.slice(rootCount);
    expect(laneEvents.every((event) => event.agentId === "sub-1")).toBe(true);
    expect(laneEvents.map((event) => event.id)).toEqual([
      "sub-1:transcript_full.jsonl:1",
      "sub-1:transcript_full.jsonl:2",
      "sub-1:transcript_full.jsonl:2:1",
      "sub-1:transcript_full.jsonl:2:2",
      "sub-1:transcript_full.jsonl:3",
      "sub-1:transcript_full.jsonl:4",
      "sub-1:transcript_full.jsonl:4:1",
      "sub-1:transcript_full.jsonl:5"
    ]);
    expect(laneEvents[1]).toMatchObject({
      kind: "request",
      requestId: "sub-1:1",
      source: { file: `/agy/antigravity-cli/brain/sub-1/${LOGS}/transcript_full.jsonl`, line: 2 }
    });

    // The parent's relayed replies and the child's relayed prompt stay system events; only the root's user
    // record is a turn, while the subagent's requests count with the session's.
    const summary = foldTranscript(loaded.value);
    expect(summary).toMatchObject({ turns: 1, requests: 6, subagents: 1 });
    const prompts = { limit: 10, maxChars: 100 };
    const summed = await summarizeSession(platform, ref, { providers, prompts, requestUsage: true });
    expect(summed.ok).toBe(true);
    if (summed.ok) {
      expect(summed.value.prompts).toEqual([{ text: "Run the unit tests" }]);
      expect(summed.value.requestUsage).toHaveLength(6);
      expect(summed.value).toEqual({
        ...summary,
        prompts: sessionPrompts(loaded.value, prompts),
        requestUsage: sessionRequestUsage(loaded.value)
      });
    }
  });

  it("keeps a spawned conversation without a transcript as an unavailable lane, also outside the transcript layout", async () => {
    const brain = "/agy/antigravity-cli/brain";
    const outside = `/agy/elsewhere/transcript.jsonl`;
    const parent = [
      JSON.stringify({ step_index: 0, type: "USER_INPUT", content: "Delegate" }),
      JSON.stringify({
        step_index: 1,
        type: "PLANNER_RESPONSE",
        model: "gemini-test",
        input_tokens: 10,
        output_tokens: 1,
        tool_calls: [{ name: "invoke_subagent", args: { Prompt: "Go", Role: "Ghost", TypeName: "research" } }]
      }),
      JSON.stringify({ step_index: 2, type: "GENERIC", content: subagentCreated("sub-gone") })
    ];
    const platform = createMemoryPlatform({
      files: { [`${brain}/conv-2/${LOGS}/transcript.jsonl`]: parent.join("\n"), [outside]: parent.join("\n") }
    });

    // Under the brain root the conversation's directory does not exist; outside the layout no brain root is known.
    for (const path of [`${brain}/conv-2/${LOGS}/transcript.jsonl`, outside]) {
      const target = { agent: "agy" as const, path };
      const loaded = await agySessionAdapter.load(platform, target);
      expect(loaded.ok).toBe(true);
      if (!loaded.ok) {
        return;
      }
      const spawn = loaded.value.events.find((event) => event.kind === "tool_call");
      expect(loaded.value.agents).toEqual([
        { id: "agy" },
        { id: "sub-gone", parentId: "agy", spawnEventId: spawn?.id, title: "Ghost", unavailable: true }
      ]);
      const folded = foldTranscript(loaded.value);
      expect(folded.subagents).toBe(1);
      const summed = await summarizeSession(platform, target, { providers });
      expect(summed.ok).toBe(true);
      if (summed.ok) {
        expect(summed.value).toEqual(folded);
      }
      const withUsage = await summarizeSession(platform, target, { providers, requestUsage: true });
      expect(withUsage.ok).toBe(true);
      if (withUsage.ok) {
        expect(withUsage.value.requestUsage).toHaveLength(1);
      }
    }
  });

  it("rejects with the abort reason while attaching a subagent", async () => {
    const platform = createMemoryPlatform({ files: await readTree(fixtures, "/agy") });
    const controller = new AbortController();
    const reason = new Error("stop while attaching");
    const { fs } = platform;
    const aborting: SessionPlatform = {
      fs: {
        stat: (path, options) => {
          if (path.includes("/sub-1/")) {
            controller.abort(reason);
          }
          return fs.stat(path, options);
        },
        list: (dir) => fs.list(dir),
        read: (path, range) => fs.read(path, range)
      }
    };
    await expect(agySessionAdapter.load(aborting, ref, { signal: controller.signal })).rejects.toBe(reason);
  });
});

describe("agy sessions and usage edge cases", () => {
  it("falls back to transcript.jsonl when transcript_full.jsonl is absent, handles errors/compactions/skips", async () => {
    const path = "/agy/antigravity-cli/brain/conv-edge/.system_generated/logs/transcript.jsonl";
    const lines = [
      "not-json",
      JSON.stringify({ missingType: true }),
      JSON.stringify({
        step_index: 0,
        type: "PLANNER_RESPONSE",
        created_at: "2026-11-18T10:00:00Z",
        model: "gemini-test",
        input_tokens: 10,
        output_tokens: 5,
        tool_calls: [{ name: "abandoned_tool" }]
      }),
      // USER_INPUT resets pendingCalls so the standalone GENERIC below does not falsely pair with abandoned_tool.
      JSON.stringify({ step_index: 1, type: "USER_INPUT", content: "Second turn" }),
      JSON.stringify({ step_index: 2, type: "GENERIC", content: "Standalone output" }),
      JSON.stringify({
        step_index: 3,
        type: "PLANNER_RESPONSE",
        model: "gemini-test",
        tool_calls: [{ name: "failing_tool" }]
      }),
      JSON.stringify({ step_index: 4, type: "GENERIC", status: "ERROR", error: "boom" }),
      JSON.stringify({
        step_index: 5,
        type: "CHECKPOINT",
        model: "gemini-test",
        input_tokens: 20,
        output_tokens: 10,
        content: "Summary"
      }),
      JSON.stringify({ step_index: 6, type: "ERROR_MESSAGE", error: "fatal" }),
      JSON.stringify({ step_index: 7, type: "FUTURE_TYPE", content: "ignored" })
    ].join("\n");

    const platform = createMemoryPlatform({ files: { [path]: lines } });
    const heads = [];
    for await (const item of agySessionAdapter.discover(platform, "/agy/antigravity-cli/brain")) {
      heads.push(item);
    }
    expect(heads).toHaveLength(1);
    expect(heads[0]).toMatchObject({ ref: { path, sessionId: "conv-edge" } });

    const loaded = await agySessionAdapter.load(platform, { agent: "agy", path, sessionId: "conv-edge" });
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) {
      return;
    }

    const { events, skipped } = loaded.value;
    // CHECKPOINT's own request is NOT shadowed by the compaction it produced.
    const compaction = events.find((event) => event.kind === "compaction");
    const checkpointRequest = events.find((event) => event.kind === "request" && event.requestId === "5");
    expect(compaction).toBeDefined();
    expect(checkpointRequest).toBeDefined();
    expect(checkpointRequest?.shadowedBy).toBeUndefined();

    // Standalone GENERIC after USER_INPUT becomes a system event, not a tool_result.
    expect(events.some((event) => event.kind === "system" && event.payload.type === "generic")).toBe(true);
    // Failing GENERIC paired with failing_tool marks isError: true and falls back to error when content is absent.
    expect(
      events.some(
        (event) => event.kind === "tool_result" && event.payload.isError === true && event.payload.output === "boom"
      )
    ).toBe(true);
    // ERROR_MESSAGE becomes a system error event.
    expect(
      events.some(
        (event) => event.kind === "system" && event.payload.type === "error" && event.payload.text === "fatal"
      )
    ).toBe(true);
    // Invalid JSON, invalid shape, and FUTURE_TYPE are accounted for in skipped.
    expect(skipped).toHaveLength(3);
  });

  it("propagates abort in discover and separates step_index vs line usage keys", async () => {
    const path = "/agy/antigravity-cli/brain/conv-keys/.system_generated/logs/transcript.jsonl";
    const lines = [
      JSON.stringify({ type: "PLANNER_RESPONSE", input_tokens: 10, output_tokens: 5 }), // line 1, no step_index
      JSON.stringify({ step_index: 1, type: "PLANNER_RESPONSE", input_tokens: 20, output_tokens: 10 }) // line 2, step_index 1
    ].join("\n");
    const platform = createMemoryPlatform({ files: { [path]: lines } });

    const controller = new AbortController();
    controller.abort(new Error("stop"));
    await expect(async () => {
      for await (const _item of agySessionAdapter.discover(platform, "/agy/antigravity-cli/brain", {
        signal: controller.signal
      })) {
        // should abort before yielding
      }
    }).rejects.toThrow("stop");

    const records = [];
    for await (const item of agyUsageDecoder.decode(platform, { path })) {
      if ("usage" in item) {
        records.push(item);
      }
    }
    expect(records).toHaveLength(2);
    const keys = records.map((record) => agyUsageDecoder.usageKey(record));
    expect(new Set(keys).size).toBe(2);
  });

  it("ignores stray transcript.jsonl files outside .system_generated/logs in usage sources", async () => {
    const validPath = "/agy/antigravity-cli/brain/conv-1/.system_generated/logs/transcript.jsonl";
    const strayScratch = "/agy/antigravity-cli/brain/conv-1/scratch/transcript.jsonl";
    const strayRoot = "/agy/antigravity-cli/brain/conv-1/transcript.jsonl";
    const line = JSON.stringify({ step_index: 0, type: "PLANNER_RESPONSE", input_tokens: 10, output_tokens: 5 });
    const platform = createMemoryPlatform({
      files: { [validPath]: line, [strayScratch]: line, [strayRoot]: line }
    });
    const home = homeFromRule("agy", agy.home, { home: "/agy", env: { ANTIGRAVITY_GEMINI_DIR: "/agy" } });
    const found: string[] = [];
    for await (const item of agyUsageDecoder.sources(platform, home)) {
      if ("path" in item && !("error" in item)) {
        found.push(item.path);
      }
    }
    expect(found).toEqual([validPath]);
  });
});

describe("agy hooks and install edge cases", () => {
  it("falls back to workspacePaths[0] when cwd is absent and handles unknown Stop terminationReason", () => {
    const event = readHookEvent(
      "agy",
      {
        hookEventName: "Stop",
        conversationId: "conv-1",
        workspacePaths: ["/u/me/fallback"],
        artifactDirectoryPath: "/u/me/.gemini/antigravity-cli/brain/conv-1",
        terminationReason: "OTHER_REASON"
      },
      {},
      { providers: { hooks: { agy: agyHookDialect } } }
    );
    expect(event).toMatchObject({
      agent: "agy",
      phase: "finish",
      scope: "turn",
      cwd: "/u/me/fallback"
    });
    expect(event.outcome).toBeUndefined();
  });

  it("renders skills into ~/.gemini/config/skills/<name> and returns [] for empty hooks", () => {
    const context = { home: "/u/me", env: {} };
    const bundle = { owner: "tools/acme", version: "1.0.0", digest: "sha256:0000" };
    expect(agyInstallAdapter.renderHooks("native-plugin", [], bundle, context)).toEqual([]);
    expect(
      agyInstallAdapter.renderSkill(
        "scan-directory",
        { type: "skill", name: "lint", files: { "SKILL.md": "# Lint\n" } },
        context
      )
    ).toEqual([
      {
        locator: { kind: "dir", path: "/u/me/.gemini/config/skills/lint" },
        content: { "SKILL.md": "# Lint\n" },
        strategy: "scan-directory"
      }
    ]);
  });
});
