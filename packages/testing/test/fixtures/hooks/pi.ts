import type { LifecycleEvent } from "@rivus/agent-kit-harness";

import type { HookDialectSample } from "../../../src/hook-dialect-conformance.js";

// Scrubbed Pi extension events (docs/extensions.md in earendil-works/pi), as a bridge extension forwards them: the
// event object with its name as `type`, plus `sessionId` and `cwd` from the extension context.

const sessionId = "pi-session-8c2e";
const cwd = "/u/me/work";
const identity = { agent: "pi", sessionId, cwd } as const;

function sample(
  type: string,
  fields: Record<string, unknown>,
  expected: Omit<LifecycleEvent, "agent" | "nativeEvent">
): HookDialectSample {
  return {
    name: type,
    payload: { type, ...fields, sessionId, cwd },
    expected: { ...identity, nativeEvent: type, ...expected }
  };
}

const tool = { toolCallId: "tc_3", toolName: "bash", args: { command: "ls" } };

export const piSamples: readonly HookDialectSample[] = [
  sample("session_start", { reason: "startup" }, { phase: "start", scope: "session" }),
  sample("before_agent_start", { prompt: "list files", systemPrompt: "s" }, { phase: "start", scope: "turn" }),
  sample("agent_start", {}, { phase: "start", scope: "turn" }),
  sample("turn_start", { turnIndex: 0, timestamp: 1_760_000_000_000 }, { phase: "activity" }),
  sample(
    "tool_call",
    { toolCallId: "tc_3", toolName: "bash", input: { command: "ls" } },
    {
      phase: "activity",
      tool: { name: "bash", callId: "tc_3" }
    }
  ),
  sample("tool_execution_start", tool, { phase: "activity", tool: { name: "bash", callId: "tc_3" } }),
  sample(
    "tool_execution_end",
    { ...tool, result: "a", isError: false },
    {
      phase: "activity",
      tool: { name: "bash", callId: "tc_3" }
    }
  ),
  sample("turn_end", { turnIndex: 0, outcome: "completed" }, { phase: "activity" }),
  sample("session_compact", {}, { phase: "activity" }),
  sample(
    "ui_prompt_start",
    { reason: "ui_prompt", kind: "confirm", title: "Continue?" },
    {
      phase: "blocked",
      blocker: "question"
    }
  ),
  sample("ui_prompt_end", { reason: "ui_prompt", kind: "confirm" }, { phase: "activity" }),
  sample("agent_end", { messages: [] }, { phase: "finish", scope: "turn" }),
  sample("agent_settled", {}, { phase: "finish", scope: "turn" }),
  sample("session_shutdown", { reason: "quit" }, { phase: "finish", scope: "session" })
];
