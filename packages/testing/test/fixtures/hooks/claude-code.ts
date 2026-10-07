import type { LifecycleEvent } from "@rivus/agent-kit-harness";

import type { HookDialectSample } from "../../../src/hook-dialect-conformance.js";

// Scrubbed Claude Code hook payloads (https://code.claude.com/docs/en/hooks), one or more per event.

const common = {
  session_id: "0d9c6a52-claude-session",
  transcript_path: "/u/me/.claude/projects/-u-me-work/0d9c6a52-claude-session.jsonl",
  cwd: "/u/me/work",
  permission_mode: "default",
  prompt_id: "7f3e-prompt-2"
};
const identity = {
  agent: "claude-code",
  sessionId: common.session_id,
  transcriptPath: common.transcript_path,
  cwd: common.cwd,
  turnId: common.prompt_id
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

const bash = { tool_name: "Bash", tool_input: { command: "npm test", description: "Run tests" } };
const inSubagent = { agent_id: "a91c", agent_type: "Explore" };

export const claudeCodeSamples: readonly HookDialectSample[] = [
  {
    name: "SessionStart before the first prompt has no prompt id",
    payload: {
      session_id: common.session_id,
      transcript_path: common.transcript_path,
      cwd: common.cwd,
      hook_event_name: "SessionStart",
      source: "startup",
      model: "claude-opus-5-5"
    },
    expected: {
      agent: "claude-code",
      nativeEvent: "SessionStart",
      phase: "start",
      scope: "session",
      sessionId: common.session_id,
      transcriptPath: common.transcript_path,
      cwd: common.cwd
    }
  },
  sample("SessionStart after compaction", "SessionStart", { source: "compact" }, { phase: "activity" }),
  sample(
    "SessionStart with --agent is not a subagent",
    "SessionStart",
    { source: "resume", agent_type: "reviewer" },
    {
      phase: "start",
      scope: "session"
    }
  ),
  sample("UserPromptSubmit", "UserPromptSubmit", { prompt: "fix the failing test" }, { phase: "start", scope: "turn" }),
  sample(
    "PreToolUse",
    "PreToolUse",
    { ...bash, tool_use_id: "toolu_01" },
    {
      phase: "activity",
      tool: { name: "Bash", callId: "toolu_01" }
    }
  ),
  sample(
    "PreToolUse inside a subagent",
    "PreToolUse",
    { ...bash, tool_use_id: "toolu_02", ...inSubagent },
    {
      phase: "activity",
      tool: { name: "Bash", callId: "toolu_02" },
      subagent: { id: "a91c", type: "Explore" }
    }
  ),
  sample("PermissionRequest has no tool_use_id", "PermissionRequest", bash, {
    phase: "blocked",
    blocker: "permission",
    tool: { name: "Bash" }
  }),
  sample(
    "PermissionDenied",
    "PermissionDenied",
    { ...bash, tool_use_id: "toolu_03", reason: "auto mode" },
    {
      phase: "activity",
      tool: { name: "Bash", callId: "toolu_03" }
    }
  ),
  sample(
    "PostToolUse",
    "PostToolUse",
    { ...bash, tool_use_id: "toolu_01", tool_response: { stdout: "ok" } },
    {
      phase: "activity",
      tool: { name: "Bash", callId: "toolu_01" }
    }
  ),
  sample(
    "PostToolUseFailure",
    "PostToolUseFailure",
    { ...bash, tool_use_id: "toolu_04", error: "exit 1" },
    {
      phase: "activity",
      tool: { name: "Bash", callId: "toolu_04" }
    }
  ),
  sample(
    "PostToolBatch",
    "PostToolBatch",
    { tool_calls: [{ tool_name: "Read", tool_use_id: "toolu_05" }] },
    {
      phase: "activity"
    }
  ),
  sample(
    "Notification permission_prompt",
    "Notification",
    { notification_type: "permission_prompt", message: "m" },
    {
      phase: "blocked",
      blocker: "permission"
    }
  ),
  sample(
    "Notification elicitation_dialog",
    "Notification",
    { notification_type: "elicitation_dialog", message: "m" },
    {
      phase: "blocked",
      blocker: "elicitation"
    }
  ),
  sample(
    "Notification idle_prompt",
    "Notification",
    { notification_type: "idle_prompt", message: "m" },
    {
      phase: "finish",
      scope: "turn"
    }
  ),
  sample(
    "Notification of another type",
    "Notification",
    { notification_type: "auth_success", message: "m" },
    {
      phase: "unknown"
    }
  ),
  sample("SubagentStart", "SubagentStart", inSubagent, { phase: "start", subagent: { id: "a91c", type: "Explore" } }),
  sample(
    "SubagentStop",
    "SubagentStop",
    { ...inSubagent, stop_hook_active: false, agent_transcript_path: "/u/me/.claude/projects/x/subagents/a.jsonl" },
    { phase: "finish", subagent: { id: "a91c", type: "Explore" } }
  ),
  sample(
    "Stop",
    "Stop",
    { stop_hook_active: false, last_assistant_message: "done" },
    {
      phase: "finish",
      scope: "turn",
      outcome: "completed"
    }
  ),
  sample("StopFailure", "StopFailure", { error: "rate_limit" }, { phase: "finish", scope: "turn", outcome: "failed" }),
  sample("PreCompact", "PreCompact", { trigger: "auto", custom_instructions: "" }, { phase: "activity" }),
  sample("PostCompact", "PostCompact", { trigger: "auto", compact_summary: "summary" }, { phase: "activity" }),
  sample(
    "Elicitation",
    "Elicitation",
    { mcp_server_name: "docs", message: "Pick one", mode: "form" },
    {
      phase: "blocked",
      blocker: "elicitation"
    }
  ),
  sample(
    "ElicitationResult",
    "ElicitationResult",
    { mcp_server_name: "docs", action: "accept" },
    {
      phase: "activity"
    }
  ),
  sample("SessionEnd", "SessionEnd", { reason: "prompt_input_exit" }, { phase: "finish", scope: "session" }),
  {
    name: "the session id falls back to CLAUDE_CODE_SESSION_ID, and the pane comes from tmux",
    payload: { hook_event_name: "Stop", cwd: common.cwd },
    env: { CLAUDE_CODE_SESSION_ID: "env-session", TMUX_PANE: "%3" },
    expected: {
      agent: "claude-code",
      nativeEvent: "Stop",
      phase: "finish",
      scope: "turn",
      outcome: "completed",
      sessionId: "env-session",
      cwd: common.cwd,
      terminal: { host: "tmux", paneId: "%3" }
    }
  }
];
