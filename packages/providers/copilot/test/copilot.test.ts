import { describe, expect, it } from "vite-plus/test";
import { readHookEvent } from "@rivus/agent-kit-harness/public/events";
import { foldTranscript, sessionPrompts, sessionRequestUsage } from "@rivus/agent-kit-sessions/public";
import { createMemoryPlatform } from "@rivus/agent-kit-testing/public";
import { copilotHookDialect } from "../src/hooks.js";
import { copilotSessionAdapter } from "../src/sessions.js";
import { copilotUsageDecoder } from "../src/usage.js";

const BASE = "/u/me/.copilot/session-state";

describe("copilot review regressions", () => {
  it("follows rotated session.journal_link segments oldest-first and deduplicates checkpoint replays", async () => {
    const prevPath = `${BASE}/s-rot/events.1.jsonl`;
    const curPath = `${BASE}/s-rot/events.jsonl`;
    const prev = [
      JSON.stringify({
        type: "session.start",
        id: "r1",
        timestamp: "2026-11-24T10:00:00.000Z",
        parentId: null,
        data: { sessionId: "s-rot", version: 1, context: { cwd: "/w" } }
      }),
      JSON.stringify({
        type: "user.message",
        id: "r2",
        timestamp: "2026-11-24T10:00:01.000Z",
        parentId: "r1",
        data: { content: "First turn" }
      }),
      JSON.stringify({
        type: "session.usage_record",
        id: "r3",
        timestamp: "2026-11-24T10:00:02.000Z",
        parentId: "r2",
        data: { usage: { model: "gpt-test", apiCallId: "api-old", inputTokens: 100, outputTokens: 10, duration: 100 } }
      })
    ].join("\n");
    const cur = [
      JSON.stringify({
        type: "session.journal_link",
        id: "r4",
        timestamp: "2026-11-24T10:05:00.000Z",
        parentId: null,
        data: { previousFile: "events.1.jsonl" }
      }),
      // Duplicate id and checkpoint replay must not double-count.
      JSON.stringify({
        type: "user.message",
        id: "r2",
        timestamp: "2026-11-24T10:00:01.000Z",
        parentId: "r1",
        data: { content: "First turn" }
      }),
      JSON.stringify({
        type: "session.usage_record",
        id: "r3-replay",
        checkpoint: true,
        timestamp: "2026-11-24T10:00:02.000Z",
        parentId: "r2",
        data: { usage: { model: "gpt-test", apiCallId: "api-old", inputTokens: 100, outputTokens: 10 } }
      }),
      JSON.stringify({
        type: "user.message",
        id: "r5",
        timestamp: "2026-11-24T10:05:01.000Z",
        parentId: "r4",
        data: { content: "Second turn" }
      }),
      JSON.stringify({
        type: "session.usage_record",
        id: "r6",
        timestamp: "2026-11-24T10:05:02.000Z",
        parentId: "r5",
        data: { usage: { model: "gpt-test", apiCallId: "api-new", inputTokens: 50, outputTokens: 5, duration: 50 } }
      })
    ].join("\n");

    const platform = createMemoryPlatform({ files: { [prevPath]: prev, [curPath]: cur } });
    const ref = { agent: "copilot" as const, path: curPath, sessionId: "s-rot" };
    const loaded = await copilotSessionAdapter.load(platform, ref);
    const summed = await copilotSessionAdapter.summarize!(platform, ref, { prompts: { limit: 5, maxChars: 100 } });
    expect(loaded.ok).toBe(true);
    expect(summed.ok).toBe(true);
    if (loaded.ok && summed.ok) {
      const folded = foldTranscript(loaded.value);
      expect(folded.turns).toBe(2);
      expect(folded.requests).toBe(2);
      expect(folded.inputTokens).toBe(150);
      expect(loaded.value.capabilities).not.toContain("systemPrompt");
      expect(summed.value).toStrictEqual({
        ...folded,
        prompts: sessionPrompts(loaded.value, { limit: 5, maxChars: 100 }),
        requestUsage: sessionRequestUsage(loaded.value)
      });
    }
  });

  it("handles failed compaction, nested subagent parentId, injected main-lane prompts, and attachment-only turns", async () => {
    const path = `${BASE}/s-edge/events.jsonl`;
    const lines = [
      JSON.stringify({
        type: "session.start",
        id: "e1",
        timestamp: "2026-11-24T11:00:00.000Z",
        parentId: null,
        data: { sessionId: "s-edge", version: 1 }
      }),
      // Attachment-only turn (empty content, non-empty attachments, hasSubmittedTask: true) -> counts as 1 turn.
      JSON.stringify({
        type: "user.message",
        id: "e2",
        timestamp: "2026-11-24T11:00:01.000Z",
        parentId: "e1",
        data: { content: "", attachments: [{ type: "image" }], hasSubmittedTask: true }
      }),
      // Skill-injected and autopilot-continuation messages on main lane -> excluded from turns/prompts.
      JSON.stringify({
        type: "user.message",
        id: "e3",
        timestamp: "2026-11-24T11:00:02.000Z",
        parentId: "e2",
        data: { content: "Skill body", source: "skill-review" }
      }),
      JSON.stringify({
        type: "user.message",
        id: "e4",
        timestamp: "2026-11-24T11:00:03.000Z",
        parentId: "e3",
        data: { content: "Continue", isAutopilotContinuation: true }
      }),
      // Failed compaction (success: false) -> must not shadow e2 or increment compactions, but still records summarizer usage.
      JSON.stringify({
        type: "session.compaction_complete",
        id: "e5",
        timestamp: "2026-11-24T11:00:04.000Z",
        parentId: "e4",
        data: {
          trigger: "threshold",
          success: false,
          compactionAttemptId: "cmp-fail",
          behaviorModelId: "gpt-test",
          compactionTokensUsed: { inputTokens: 80, outputTokens: 12 }
        }
      }),
      // Nested subagent: agent-a spawns agent-b via tool call on agent-a.
      JSON.stringify({
        type: "subagent.started",
        id: "e6",
        timestamp: "2026-11-24T11:00:05.000Z",
        parentId: "e5",
        agentId: "agent-a",
        data: { agentDisplayName: "Parent Worker" }
      }),
      JSON.stringify({
        type: "tool.execution_start",
        id: "e7",
        timestamp: "2026-11-24T11:00:06.000Z",
        parentId: "e6",
        agentId: "agent-a",
        data: { toolCallId: "call-nested", toolName: "task", arguments: {} }
      }),
      JSON.stringify({
        type: "subagent.started",
        id: "e8",
        timestamp: "2026-11-24T11:00:07.000Z",
        parentId: "e7",
        agentId: "agent-b",
        data: { parentId: "agent-a", toolCallId: "call-nested", agentDisplayName: "Nested Worker" }
      })
    ].join("\n");

    const platform = createMemoryPlatform({ files: { [path]: lines } });
    const ref = { agent: "copilot" as const, path, sessionId: "s-edge" };
    const loaded = await copilotSessionAdapter.load(platform, ref);
    const summed = await copilotSessionAdapter.summarize!(platform, ref, { prompts: { limit: 5, maxChars: 100 } });
    expect(loaded.ok).toBe(true);
    expect(summed.ok).toBe(true);
    if (loaded.ok && summed.ok) {
      const folded = foldTranscript(loaded.value);
      expect(folded.turns).toBe(1);
      expect(folded.compactions).toBe(0);
      expect(folded.requests).toBe(1);
      expect(folded.subagents).toBe(2);
      expect(loaded.value.events.find((e) => e.kind === "user")?.shadowedBy).toBeUndefined();
      expect(loaded.value.agents).toEqual([
        { id: "copilot" },
        { id: "agent-a", parentId: "copilot", title: "Parent Worker" },
        { id: "agent-b", parentId: "agent-a", spawnEventId: "events.jsonl:7", title: "Nested Worker" }
      ]);
      expect(summed.value.prompts).toEqual([]);
      expect(summed.value).toStrictEqual({
        ...folded,
        prompts: sessionPrompts(loaded.value, { limit: 5, maxChars: 100 }),
        requestUsage: sessionRequestUsage(loaded.value)
      });
    }
  });

  it("rejects unsupported session.start.data.version with UnknownFormatGeneration across load, summarize, and usage", async () => {
    const path = `${BASE}/s-future/events.jsonl`;
    const content = JSON.stringify({
      type: "session.start",
      id: "f1",
      timestamp: "2026-11-24T12:00:00.000Z",
      parentId: null,
      data: { sessionId: "s-future", version: 999 }
    });
    const platform = createMemoryPlatform({ files: { [path]: content } });
    const ref = { agent: "copilot" as const, path, sessionId: "s-future" };

    const loaded = await copilotSessionAdapter.load(platform, ref);
    expect(loaded.ok).toBe(false);
    if (!loaded.ok) {
      expect(loaded.error._tag).toBe("UnknownFormatGeneration");
    }

    const summed = await copilotSessionAdapter.summarize!(platform, ref);
    expect(summed.ok).toBe(false);
    if (!summed.ok) {
      expect(summed.error._tag).toBe("UnknownFormatGeneration");
    }

    const items = [];
    for await (const item of copilotUsageDecoder.decode(platform, { path })) {
      items.push(item);
    }
    expect(items).toHaveLength(1);
    expect("error" in items[0]! && items[0].error._tag).toBe("UnknownFormatGeneration");
  });

  it("maps SessionEnd hook reasons to distinct lifecycle outcomes", () => {
    const options = { providers: { hooks: { copilot: copilotHookDialect } } };
    const env = { COPILOT_CLI: "1" };
    const read = (reason: string) =>
      readHookEvent("copilot", { hook_event_name: "SessionEnd", session_id: "s1", cwd: "/w", reason }, env, options);
    expect(read("complete").outcome).toBe("completed");
    expect(read("error").outcome).toBe("failed");
    expect(read("timeout").outcome).toBe("failed");
    expect(read("abort").outcome).toBe("cancelled");
    expect(read("other").outcome).toBeUndefined();
  });
});
