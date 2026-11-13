import type { LifecycleEvent } from "@rivus/agent-kit-harness/public/events";

import type { HookDialectSample } from "@rivus/agent-kit-testing/public";

// Synthetic Kimi Code hook payloads (customization/hooks.html), passed on stdin as JSON: the base fields every event
// carries, plus the per-event ones the guide documents.

const sessionId = "session_abc123";
const cwd = "/u/me/work";
const identity = { agent: "kimi", sessionId, cwd } as const;

function sample(
  event: string,
  fields: Record<string, unknown>,
  expected: Omit<LifecycleEvent, "agent" | "nativeEvent">
): HookDialectSample {
  return {
    name: event,
    payload: { hook_event_name: event, session_id: sessionId, session_title: "Fix the login page", client_type: "kimi_code_cli", cwd, ...fields },
    expected: { ...identity, nativeEvent: event, ...expected }
  };
}

export const kimiSamples: readonly HookDialectSample[] = [
  sample("SessionStart", { source: "startup", model: "kimi-for-coding" }, { phase: "start", scope: "session" }),
  sample("SessionStart", { source: "compact" }, { phase: "activity" }),
  sample("SessionEnd", { source: "exit" }, { phase: "finish", scope: "session" }),
  sample("UserPromptSubmit", { prompt: "list files" }, { phase: "start", scope: "turn" }),
  sample("TurnStarted", { turn_id: "t1", origin_kind: "user", origin_name: "u", prompt: "list files" }, { phase: "activity" }),
  sample(
    "PreToolUse",
    { tool_name: "Bash", tool_use_id: "tc_3", tool_input: { command: "ls" } },
    { phase: "activity", tool: { name: "Bash", callId: "tc_3" } }
  ),
  sample(
    "PostToolUse",
    { tool_name: "Bash", tool_use_id: "tc_3", tool_input: { command: "ls" }, tool_response: "ok" },
    { phase: "activity", tool: { name: "Bash", callId: "tc_3" } }
  ),
  sample(
    "PostToolUseFailure",
    { tool_name: "Bash", tool_use_id: "tc_3", tool_input: { command: "ls" } },
    { phase: "activity", tool: { name: "Bash", callId: "tc_3" } }
  ),
  sample("PermissionRequest", { tool_name: "Bash", tool_use_id: "tc_3" }, { phase: "blocked", blocker: "permission", tool: { name: "Bash", callId: "tc_3" } }),
  sample("PermissionResult", { tool_name: "Bash", tool_use_id: "tc_3" }, { phase: "activity", tool: { name: "Bash", callId: "tc_3" } }),
  sample("SubagentStart", { agent_id: "agent-0", agent_type: "explorer" }, { phase: "start", subagent: { id: "agent-0", type: "explorer" } }),
  sample("SubagentStop", { agent_id: "agent-0", agent_type: "explorer" }, { phase: "finish", subagent: { id: "agent-0", type: "explorer" } }),
  sample("TaskStarted", { task_id: "task_1", description: "run tests", detached: false }, { phase: "activity" }),
  sample("Stop", {}, { phase: "finish", scope: "turn", outcome: "completed" }),
  sample("StopFailure", { error: "api" }, { phase: "finish", scope: "turn", outcome: "failed" }),
  sample("Interrupt", { reason: "esc" }, { phase: "finish", scope: "turn" }),
  sample("PreCompact", { trigger: "auto" }, { phase: "activity" }),
  sample("PostCompact", { trigger: "manual" }, { phase: "activity" }),
  sample("Notification", { notification_type: "task.completed" }, { phase: "activity" }),
  sample("UserPromptQueued", { prompt_id: "p9", prompt: "more", queue_length: 1 }, { phase: "activity" }),
  sample("SessionHeartbeat", { uptime_ms: 60_000 }, { phase: "activity" })
];
