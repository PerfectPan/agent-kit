import type { LifecycleEvent } from "@rivus/agent-kit-harness";

import type { HookDialectSample } from "../../../src/hook-dialect-conformance.js";

// Scrubbed Cursor hook payloads (https://cursor.com/docs/hooks), one or more per event.

const common = {
  conversation_id: "c0nv-cursor-1",
  generation_id: "gen-1",
  model: "default",
  cursor_version: "3.13.25",
  workspace_roots: ["/u/me/work"],
  user_email: null,
  transcript_path: "/u/me/.cursor/projects/u-me-work/agent-transcripts/c0nv-cursor-1.txt"
};
const identity = {
  agent: "cursor",
  sessionId: common.conversation_id,
  turnId: common.generation_id,
  cwd: "/u/me/work",
  transcriptPath: common.transcript_path
} as const;

function sample(
  name: string,
  event: string,
  extra: Record<string, unknown>,
  expected: Omit<LifecycleEvent, "agent" | "nativeEvent">
): HookDialectSample {
  return {
    name,
    payload: { ...common, hook_event_name: event, ...extra },
    expected: { ...identity, nativeEvent: event, ...expected }
  };
}

const shell = { command: "npm test", cwd: "/u/me/work/app", sandbox: false };
const tool = { tool_name: "Shell", tool_input: { command: "npm test" }, tool_use_id: "tool-1" };

export const cursorSamples: readonly HookDialectSample[] = [
  sample(
    "sessionStart",
    "sessionStart",
    { session_id: common.conversation_id, composer_mode: "agent" },
    {
      phase: "start",
      scope: "session"
    }
  ),
  sample(
    "beforeSubmitPrompt",
    "beforeSubmitPrompt",
    { prompt: "fix it", attachments: [] },
    {
      phase: "start",
      scope: "turn"
    }
  ),
  sample(
    "preToolUse",
    "preToolUse",
    { ...tool, cwd: "/u/me/work/app" },
    {
      phase: "activity",
      cwd: "/u/me/work/app",
      tool: { name: "Shell", callId: "tool-1" }
    }
  ),
  sample(
    "postToolUse",
    "postToolUse",
    { ...tool, tool_output: "{}", duration: 12 },
    {
      phase: "activity",
      tool: { name: "Shell", callId: "tool-1" }
    }
  ),
  sample(
    "postToolUseFailure",
    "postToolUseFailure",
    { ...tool, failure_type: "timeout", error_message: "t" },
    {
      phase: "activity",
      tool: { name: "Shell", callId: "tool-1" }
    }
  ),
  sample("beforeShellExecution", "beforeShellExecution", shell, { phase: "activity", cwd: "/u/me/work/app" }),
  sample(
    "afterShellExecution",
    "afterShellExecution",
    { ...shell, output: "ok", duration: 9 },
    {
      phase: "activity",
      cwd: "/u/me/work/app"
    }
  ),
  sample(
    "beforeMCPExecution",
    "beforeMCPExecution",
    { tool_name: "search", tool_input: "{}", mcp_server_name: "docs" },
    {
      phase: "activity",
      tool: { name: "search" }
    }
  ),
  sample(
    "afterMCPExecution",
    "afterMCPExecution",
    { tool_name: "search", tool_input: "{}", result_json: "{}" },
    {
      phase: "activity",
      tool: { name: "search" }
    }
  ),
  sample(
    "beforeReadFile",
    "beforeReadFile",
    { file_path: "/u/me/work/a.ts", content: "x", attachments: [] },
    {
      phase: "activity"
    }
  ),
  sample(
    "beforeTabFileRead is a gate outside the agent's lifecycle",
    "beforeTabFileRead",
    { file_path: "a.ts" },
    {
      phase: "unknown"
    }
  ),
  sample("afterFileEdit", "afterFileEdit", { file_path: "/u/me/work/a.ts", edits: [] }, { phase: "activity" }),
  sample("afterAgentResponse", "afterAgentResponse", { text: "done" }, { phase: "activity" }),
  sample("afterAgentThought", "afterAgentThought", { text: "hmm", duration_ms: 40 }, { phase: "activity" }),
  sample("preCompact", "preCompact", { trigger: "auto", context_usage_percent: 91 }, { phase: "activity" }),
  sample(
    "subagentStart",
    "subagentStart",
    { subagent_id: "sub-1", subagent_type: "explore", task: "look", parent_conversation_id: common.conversation_id },
    { phase: "start", subagent: { id: "sub-1", type: "explore" } }
  ),
  sample(
    "subagentStop",
    "subagentStop",
    { subagent_type: "explore", status: "error", task: "look" },
    {
      phase: "finish",
      outcome: "failed",
      subagent: { type: "explore" }
    }
  ),
  sample(
    "stop completed",
    "stop",
    { status: "completed", loop_count: 0 },
    {
      phase: "finish",
      scope: "turn",
      outcome: "completed"
    }
  ),
  sample(
    "stop aborted",
    "stop",
    { status: "aborted", loop_count: 0 },
    {
      phase: "finish",
      scope: "turn",
      outcome: "cancelled"
    }
  ),
  sample(
    "sessionEnd",
    "sessionEnd",
    { session_id: common.conversation_id, reason: "user_close" },
    {
      phase: "finish",
      scope: "session"
    }
  ),
  {
    name: "a hook registered for Claude Code and run by Cursor names Cursor",
    declaredAgent: "claude-code",
    payload: { ...common, hook_event_name: "preToolUse", session_id: common.conversation_id, ...tool },
    env: { CURSOR_VERSION: "3.13.25", CLAUDE_PROJECT_DIR: "/u/me/work" },
    expected: { ...identity, nativeEvent: "preToolUse", phase: "activity", tool: { name: "Shell", callId: "tool-1" } }
  },
  {
    name: "CURSOR_VERSION alone names Cursor, and a Claude Code event name maps to Cursor's",
    declaredAgent: "claude-code",
    payload: { hook_event_name: "Stop", session_id: "c0nv-cursor-1", status: "completed" },
    env: { CURSOR_VERSION: "3.13.25", CMUX_SURFACE_ID: "5D1A-surface" },
    expected: {
      agent: "cursor",
      nativeEvent: "Stop",
      phase: "finish",
      scope: "turn",
      outcome: "completed",
      sessionId: "c0nv-cursor-1",
      terminal: { host: "cmux", paneId: "5D1A-surface" }
    }
  }
];
