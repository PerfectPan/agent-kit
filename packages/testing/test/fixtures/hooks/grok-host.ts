
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

const bash = { toolName: "run_terminal_command", toolUseId: "tc-1", toolInput: { command: "ls" } };

export const grokHostSamples: readonly HookDialectSample[] = [
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
