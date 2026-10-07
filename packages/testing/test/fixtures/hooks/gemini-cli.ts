import type { LifecycleEvent } from "@rivus/agent-kit-harness";

import type { HookDialectSample } from "../../../src/hook-dialect-conformance.js";

// Scrubbed Gemini CLI hook payloads (docs/hooks/reference.md in google-gemini/gemini-cli), one per event.

const common = {
  session_id: "5b1e-gemini-session",
  transcript_path: "/u/me/.gemini/tmp/work/chats/session-5b1e.json",
  cwd: "/u/me/work",
  timestamp: "2026-10-07T10:00:00.000Z"
};
const identity = {
  agent: "gemini-cli",
  sessionId: common.session_id,
  transcriptPath: common.transcript_path,
  cwd: common.cwd
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

const shell = { tool_name: "run_shell_command", tool_input: { command: "npm test" } };
const request = { llm_request: { model: "gemini-3-pro", messages: [] } };

export const geminiCliSamples: readonly HookDialectSample[] = [
  sample("SessionStart", "SessionStart", { source: "startup" }, { phase: "start", scope: "session" }),
  sample("BeforeAgent", "BeforeAgent", { prompt: "explain this file" }, { phase: "start", scope: "turn" }),
  sample("BeforeModel", "BeforeModel", request, { phase: "activity" }),
  sample("AfterModel", "AfterModel", { ...request, llm_response: { candidates: [] } }, { phase: "activity" }),
  sample("BeforeToolSelection", "BeforeToolSelection", request, { phase: "activity" }),
  sample("BeforeTool", "BeforeTool", shell, { phase: "activity", tool: { name: "run_shell_command" } }),
  sample(
    "AfterTool",
    "AfterTool",
    { ...shell, tool_response: { llmContent: "ok" } },
    {
      phase: "activity",
      tool: { name: "run_shell_command" }
    }
  ),
  sample("PreCompress", "PreCompress", { trigger: "auto" }, { phase: "activity" }),
  sample(
    "Notification ToolPermission",
    "Notification",
    { notification_type: "ToolPermission", message: "Tool requires execution", details: { type: "exec" } },
    { phase: "blocked", blocker: "permission" }
  ),
  sample(
    "AfterAgent",
    "AfterAgent",
    { prompt: "explain this file", prompt_response: "done", stop_hook_active: false },
    {
      phase: "finish",
      scope: "turn"
    }
  ),
  sample("SessionEnd", "SessionEnd", { reason: "exit" }, { phase: "finish", scope: "session" }),
  {
    name: "an unrecorded session sends an empty transcript path",
    payload: { ...common, transcript_path: "", hook_event_name: "AfterAgent" },
    env: { GEMINI_SESSION_ID: "ignored-when-the-payload-has-one" },
    expected: {
      agent: "gemini-cli",
      nativeEvent: "AfterAgent",
      phase: "finish",
      scope: "turn",
      sessionId: common.session_id,
      cwd: common.cwd
    }
  },
  {
    name: "a Claude Code event name is unknown to Gemini CLI",
    payload: { ...common, hook_event_name: "UserPromptSubmit" },
    expected: { ...identity, nativeEvent: "UserPromptSubmit", phase: "unknown" }
  }
];
