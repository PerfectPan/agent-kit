import type { HookDialectSample } from "@rivus/agent-kit-testing/public";

const sessionId = "sess-1";
const cwd = "/u/me/work";
const transcriptPath = "/u/me/.copilot/session-state/sess-1/events.jsonl";
const base = { session_id: sessionId, cwd };

const sample = (
  event: string,
  extra: Record<string, unknown>,
  expected: Omit<HookDialectSample["expected"], "agent" | "sessionId" | "cwd" | "nativeEvent">
): HookDialectSample => {
  const reason = extra["stop_reason"];
  return {
    name: typeof reason === "string" ? `${event} (${reason})` : event,
    payload: { ...base, hook_event_name: event, ...extra },
    expected: { agent: "copilot", sessionId, cwd, nativeEvent: event, ...expected }
  };
};

export const copilotSamples: readonly HookDialectSample[] = [
  sample("SessionStart", { source: "new" }, { phase: "start", scope: "session" }),
  sample("UserPromptSubmit", { prompt: "Run the unit tests" }, { phase: "start", scope: "turn" }),
  sample(
    "PreToolUse",
    { tool_use_id: "call-1", tool_name: "bash", tool_input: { command: "pnpm test" } },
    { phase: "activity", tool: { name: "bash", callId: "call-1" } }
  ),
  sample(
    "PostToolUse",
    { tool_use_id: "call-1", tool_name: "bash" },
    { phase: "activity", tool: { name: "bash", callId: "call-1" } }
  ),
  sample(
    "PostToolUseFailure",
    { tool_use_id: "call-2", tool_name: "view", error: "Path does not exist" },
    { phase: "activity", tool: { name: "view", callId: "call-2" } }
  ),
  sample("SubagentStart", {}, { phase: "activity" }),
  sample("SubagentStop", {}, { phase: "activity" }),
  sample(
    "Stop",
    { transcript_path: transcriptPath, stop_reason: "end_turn" },
    { phase: "finish", scope: "turn", outcome: "completed", transcriptPath }
  ),
  sample("SessionEnd", { reason: "complete" }, { phase: "finish", scope: "session", outcome: "completed" })
];
