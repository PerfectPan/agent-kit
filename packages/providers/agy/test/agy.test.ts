import { homeFromRule } from "@rivus/agent-kit-catalog/spi";
import { readHookEvent } from "@rivus/agent-kit-harness/public/events";
import { createMemoryPlatform } from "@rivus/agent-kit-testing/public";
import { describe, expect, it } from "vite-plus/test";
import { agyHookDialect } from "../src/hooks.js";
import { agy } from "../src/identity.js";
import { agyInstallAdapter } from "../src/install.js";
import { agySessionIdFromPath } from "../src/layout.js";
import { agyStepOf, agyUsageOf } from "../src/records.js";
import { agySessionAdapter } from "../src/sessions.js";
import { agyUsageDecoder } from "../src/usage.js";

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
