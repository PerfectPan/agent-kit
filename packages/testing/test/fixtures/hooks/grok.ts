import type { LifecycleEvent } from "@rivus/agent-kit-harness";

import type { HookDialectSample } from "../../../src/hook-dialect-conformance.js";

// Scrubbed Grok hook payloads (user guide 10-hooks.md and xai-grok-hooks/src/event.rs in xai-org/grok-build): the
// camelCase keys every build sends, with hookEventName as the snake_case wire name.

const common = {
  sessionId: "019a-grok-session",
  cwd: "/u/me/work",
  workspaceRoot: "/u/me/work",
  timestamp: "2026-10-07T10:00:00.000Z",
  transcriptPath: "/u/me/.grok/sessions/%2Fu%2Fme%2Fwork/019a-grok-session/updates.jsonl"
};
const identity = {
  agent: "grok",
  sessionId: common.sessionId,
  cwd: common.cwd,
  transcriptPath: common.transcriptPath
} as const;
const env = { GROK_SESSION_ID: common.sessionId, GROK_HOOK_EVENT: "ignored-when-the-payload-names-one" };

function sample(
  name: string,
  wire: string,
  extra: Record<string, unknown>,
  expected: Omit<LifecycleEvent, "agent" | "nativeEvent">
): HookDialectSample {
  return {
    name,
    payload: { ...common, hookEventName: wire, ...extra },
    env,
    expected: { ...identity, nativeEvent: wire, ...expected }
  };
}

const prompt = { promptId: "4c1d-prompt" };
const bash = { toolName: "run_terminal_command", toolUseId: "tc-1", toolInput: { command: "ls" } };

export const grokSamples: readonly HookDialectSample[] = [
  sample("SessionStart", "session_start", { source: "startup" }, { phase: "start", scope: "session" }),
  sample(
    "UserPromptSubmit",
    "user_prompt_submit",
    { ...prompt, prompt: "list files" },
    {
      phase: "start",
      scope: "turn",
      turnId: "4c1d-prompt"
    }
  ),
  sample(
    "PreToolUse carries no promptId",
    "pre_tool_use",
    { ...bash, toolInputTruncated: false },
    {
      phase: "activity",
      tool: { name: "run_terminal_command", callId: "tc-1" }
    }
  ),
  sample(
    "PreToolUse inside a subagent",
    "pre_tool_use",
    { ...bash, subagentType: "explore" },
    {
      phase: "activity",
      tool: { name: "run_terminal_command", callId: "tc-1" },
      subagent: { type: "explore" }
    }
  ),
  sample(
    "PostToolUse",
    "post_tool_use",
    { ...bash, toolResult: "a\nb", isBackgrounded: false },
    {
      phase: "activity",
      tool: { name: "run_terminal_command", callId: "tc-1" }
    }
  ),
  sample(
    "PostToolUseFailure",
    "post_tool_use_failure",
    { ...bash, error: "spawn failed" },
    {
      phase: "activity",
      tool: { name: "run_terminal_command", callId: "tc-1" }
    }
  ),
  sample("PermissionDenied", "permission_denied", bash, {
    phase: "activity",
    tool: { name: "run_terminal_command", callId: "tc-1" }
  }),
  sample(
    "Notification permission_prompt",
    "notification",
    { notificationType: "permission_prompt", message: "m" },
    {
      phase: "blocked",
      blocker: "permission"
    }
  ),
  sample(
    "Notification idle_prompt",
    "notification",
    { notificationType: "idle_prompt" },
    {
      phase: "finish",
      scope: "turn"
    }
  ),
  sample("Notification of another type", "notification", { notificationType: "task_complete" }, { phase: "unknown" }),
  sample(
    "SubagentStart",
    "subagent_start",
    { subagentId: "child-1", subagentType: "explore" },
    {
      phase: "start",
      subagent: { id: "child-1", type: "explore" }
    }
  ),
  sample(
    "SubagentStop",
    "subagent_stop",
    { ...prompt, phase: "gate", subagentId: "child-1", subagentType: "explore" },
    { phase: "finish", turnId: "4c1d-prompt", subagent: { id: "child-1", type: "explore" } }
  ),
  sample(
    "Stop at the end of a turn",
    "stop",
    { ...prompt, reason: "end_turn", stopHookActive: false },
    {
      phase: "finish",
      scope: "turn",
      outcome: "completed",
      turnId: "4c1d-prompt"
    }
  ),
  sample(
    "Stop when the session closes",
    "stop",
    { reason: "shutdown", stopHookActive: false },
    {
      phase: "finish",
      scope: "session"
    }
  ),
  sample(
    "StopFailure",
    "stop_failure",
    { ...prompt, error: "rate_limit" },
    {
      phase: "finish",
      scope: "turn",
      outcome: "failed",
      turnId: "4c1d-prompt"
    }
  ),
  sample(
    "StopCancelled",
    "stop_cancelled",
    { ...prompt, reason: "user_interrupt", cancelledBy: "user" },
    {
      phase: "finish",
      scope: "turn",
      outcome: "cancelled",
      turnId: "4c1d-prompt"
    }
  ),
  sample("PreCompact", "pre_compact", { source: "auto" }, { phase: "activity" }),
  sample("PostCompact", "post_compact", { source: "auto" }, { phase: "activity" }),
  sample("SessionEnd", "session_end", { reason: "shutdown", turnCount: 3 }, { phase: "finish", scope: "session" }),
  {
    name: "S30: a hook registered for Claude Code and run by Grok names Grok",
    declaredAgent: "claude-code",
    payload: {
      ...common,
      hookEventName: "pre_tool_use",
      hook_event_name: "PreToolUse",
      session_id: common.sessionId,
      transcript_path: common.transcriptPath,
      ...bash,
      tool_name: bash.toolName,
      tool_use_id: bash.toolUseId
    },
    env,
    expected: {
      ...identity,
      nativeEvent: "pre_tool_use",
      phase: "activity",
      tool: { name: "run_terminal_command", callId: "tc-1" }
    }
  },
  {
    name: "an inherited GROK_SESSION_ID does not name Grok without a Grok payload",
    declaredAgent: "claude-code",
    payload: { hook_event_name: "Stop", session_id: "claude-session-1", cwd: common.cwd },
    env: { GROK_SESSION_ID: common.sessionId, HERDR_PANE_ID: "w1:p2", TMUX_PANE: "%1" },
    expected: {
      agent: "claude-code",
      nativeEvent: "Stop",
      phase: "finish",
      scope: "turn",
      outcome: "completed",
      sessionId: "claude-session-1",
      cwd: common.cwd,
      terminal: { host: "herdr", paneId: "w1:p2" }
    }
  }
];
