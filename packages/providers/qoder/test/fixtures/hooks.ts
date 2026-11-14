import type { LifecycleEvent } from "@rivus/agent-kit-harness/public/events";

import type { HookDialectSample } from "@rivus/agent-kit-testing/public";

// Synthetic Qoder CLI hook payloads, per the agent SDK's protocol hook types: the Claude-Code-shaped snake_case base
// fields, plus the per-event fields the SDK types name.

const sessionId = "ses_8812";
const cwd = "/u/me/work";
const transcriptPath = `${cwd}/.qoder/t.jsonl`;
const identity = { agent: "qoder", sessionId, cwd, transcriptPath } as const;

function sample(
  event: string,
  fields: Record<string, unknown>,
  expected: Omit<LifecycleEvent, "agent" | "nativeEvent">
): HookDialectSample {
  return {
    name: event,
    payload: { hook_event_name: event, session_id: sessionId, cwd, transcript_path: transcriptPath, ...fields },
    expected: { ...identity, nativeEvent: event, ...expected }
  };
}

const tool = { tool_name: "Bash", tool_use_id: "tc_3", tool_input: { command: "ls" } };

export const qoderSamples: readonly HookDialectSample[] = [
  sample("SessionStart", { source: "startup" }, { phase: "start", scope: "session" }),
  sample("SessionStart", { source: "compact" }, { phase: "activity" }),
  sample("SessionEnd", { source: "exit" }, { phase: "finish", scope: "session" }),
  sample("UserPromptSubmit", { prompt: "list files" }, { phase: "start", scope: "turn" }),
  sample("PreToolUse", tool, { phase: "activity", tool: { name: "Bash", callId: "tc_3" } }),
  sample(
    "PostToolUse",
    { ...tool, tool_response: "ok" },
    { phase: "activity", tool: { name: "Bash", callId: "tc_3" } }
  ),
  sample("PostToolUseFailure", tool, { phase: "activity", tool: { name: "Bash", callId: "tc_3" } }),
  sample("PermissionRequest", tool, { phase: "blocked", blocker: "permission", tool: { name: "Bash", callId: "tc_3" } }),
  sample("PermissionDenied", { tool_name: "Bash", tool_use_id: "tc_3", reason: "policy" }, { phase: "activity", tool: { name: "Bash", callId: "tc_3" } }),
  sample("SubagentStart", { agent_id: "agent-0", agent_type: "explorer" }, { phase: "start", subagent: { id: "agent-0", type: "explorer" } }),
  sample("SubagentStop", { agent_id: "agent-0", agent_type: "explorer" }, { phase: "finish", subagent: { id: "agent-0", type: "explorer" } }),
  sample("Stop", {}, { phase: "finish", scope: "turn", outcome: "completed" }),
  sample("PreCompact", { trigger: "auto" }, { phase: "activity" }),
  sample("PostCompact", { trigger: "manual" }, { phase: "activity" }),
  sample("InstructionsLoaded", { path: "AGENTS.md" }, { phase: "activity" }),
  sample("WorktreeCreate", { path: "/u/me/wt" }, { phase: "activity" }),
  sample("WorktreeRemove", { path: "/u/me/wt" }, { phase: "activity" }),
  sample("CwdChanged", { cwd: "/u/me/other" }, { phase: "activity", cwd: "/u/me/other" }),
  sample("FileChanged", { path: "src/a.ts" }, { phase: "activity" })
];
