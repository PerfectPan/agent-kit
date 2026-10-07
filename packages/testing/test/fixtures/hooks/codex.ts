import type { LifecycleEvent } from "@rivus/agent-kit-harness";

import type { HookDialectSample } from "../../../src/hook-dialect-conformance.js";

// Scrubbed Codex hook payloads (https://developers.openai.com/codex/hooks), one or more per event.

const session = {
  session_id: "019a0c55-codex-thread",
  transcript_path: "/u/me/.codex/sessions/2026/10/07/rollout-019a0c55.jsonl",
  cwd: "/u/me/work",
  model: "gpt-5.5-codex"
};
const turn = { ...session, turn_id: "019a0c56-turn-1", permission_mode: "default" };
const identity = {
  agent: "codex",
  sessionId: session.session_id,
  transcriptPath: session.transcript_path,
  cwd: session.cwd
} as const;

function sample(
  name: string,
  event: string,
  extra: Record<string, unknown>,
  expected: Omit<LifecycleEvent, "agent" | "nativeEvent">,
  scoped: Readonly<Record<string, string>> = turn
): HookDialectSample {
  const turnId = scoped.turn_id === undefined ? {} : { turnId: scoped.turn_id };
  return {
    name,
    payload: { ...scoped, hook_event_name: event, ...extra },
    expected: { ...identity, ...turnId, nativeEvent: event, ...expected }
  };
}

const shell = { tool_name: "Bash", tool_input: { command: "cargo test" } };

export const codexSamples: readonly HookDialectSample[] = [
  sample("SessionStart", "SessionStart", { source: "startup" }, { phase: "start", scope: "session" }, session),
  sample("SessionStart after compaction", "SessionStart", { source: "compact" }, { phase: "activity" }, session),
  sample("UserPromptSubmit", "UserPromptSubmit", { prompt: "add a test" }, { phase: "start", scope: "turn" }),
  sample(
    "PreToolUse",
    "PreToolUse",
    { ...shell, tool_use_id: "call_1" },
    {
      phase: "activity",
      tool: { name: "Bash", callId: "call_1" }
    }
  ),
  sample(
    "PreToolUse inside a subagent",
    "PreToolUse",
    { ...shell, tool_use_id: "call_2", agent_id: "agent-7", agent_type: "worker" },
    { phase: "activity", tool: { name: "Bash", callId: "call_2" }, subagent: { id: "agent-7", type: "worker" } }
  ),
  sample("PermissionRequest", "PermissionRequest", shell, {
    phase: "blocked",
    blocker: "permission",
    tool: { name: "Bash" }
  }),
  sample(
    "PostToolUse",
    "PostToolUse",
    { ...shell, tool_use_id: "call_1", tool_response: "ok" },
    {
      phase: "activity",
      tool: { name: "Bash", callId: "call_1" }
    }
  ),
  sample("PreCompact", "PreCompact", { trigger: "auto" }, { phase: "activity" }),
  sample("PostCompact", "PostCompact", { trigger: "auto" }, { phase: "activity" }),
  sample(
    "SubagentStart",
    "SubagentStart",
    { agent_id: "agent-7", agent_type: "worker" },
    {
      phase: "start",
      subagent: { id: "agent-7", type: "worker" }
    }
  ),
  sample(
    "SubagentStop",
    "SubagentStop",
    { agent_id: "agent-7", agent_type: "worker", stop_hook_active: false, last_assistant_message: "done" },
    { phase: "finish", subagent: { id: "agent-7", type: "worker" } }
  ),
  sample(
    "Stop",
    "Stop",
    { stop_hook_active: false, last_assistant_message: "done" },
    {
      phase: "finish",
      scope: "turn"
    }
  ),
  sample("Interrupt", "Interrupt", {}, { phase: "finish", scope: "turn", outcome: "cancelled" }),
  sample("SessionEnd", "SessionEnd", { reason: "other" }, { phase: "finish", scope: "session" }, session)
];
