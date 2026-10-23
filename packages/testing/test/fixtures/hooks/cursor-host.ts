import type { HookDialectSample } from "../../../src/hook-dialect-conformance.js";

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

const tool = { tool_name: "Shell", tool_input: { command: "npm test" }, tool_use_id: "tool-1" };

export const cursorHostSamples: readonly HookDialectSample[] = [
  {
    name: "a hook registered for Claude Code and run by Cursor names Cursor",
    declaredAgent: "claude-code",
    payload: { ...common, hook_event_name: "preToolUse", session_id: common.conversation_id, ...tool },
    env: { CURSOR_VERSION: "3.13.25", CLAUDE_PROJECT_DIR: "/u/me/work" },
    expected: { ...identity, nativeEvent: "preToolUse", phase: "activity", tool: { name: "Shell", callId: "tool-1" } }
  },
  {
    name: "a Claude event name with the Cursor field names Cursor",
    declaredAgent: "claude-code",
    payload: { ...common, hook_event_name: "Stop", session_id: common.conversation_id, status: "completed" },
    env: {},
    expected: {
      ...identity,
      nativeEvent: "Stop",
      phase: "finish",
      scope: "turn",
      outcome: "completed"
    }
  },
  {
    name: "a Claude Code payload with an inherited CURSOR_VERSION stays Claude Code's",
    declaredAgent: "claude-code",
    payload: { hook_event_name: "Stop", session_id: "c0nv-cursor-1", status: "completed" },
    env: { CURSOR_VERSION: "3.13.25", CMUX_SURFACE_ID: "5D1A-surface" },
    expected: {
      agent: "claude-code",
      nativeEvent: "Stop",
      phase: "finish",
      scope: "turn",
      outcome: "completed",
      sessionId: "c0nv-cursor-1",
      terminal: { host: "cmux", paneId: "5D1A-surface" }
    }
  }
];
