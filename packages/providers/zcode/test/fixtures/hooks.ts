import type { LifecycleEvent } from "@rivus/agent-kit-harness/public/events";

import type { HookDialectSample } from "@rivus/agent-kit-testing/public";

// Synthetic payloads in the shape ZCode 3.17.2's engine writes: each event's camelCase hook input as the engine builds
// it, passed through `zcodePayload`, which adds what the engine's payload builder adds.

const TRANSCRIPT = "/var/folders/zz/zcode-hook-a1b2/transcript.jsonl";

/**
 * The payload written to a hook's stdin for one hook input: the input itself, Claude Code's names for its values, a
 * per-run transcript file, and the tool and per-event fields. Keys whose value is undefined are dropped, as
 * `JSON.stringify` drops them.
 */
export function zcodePayload(input: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const event = input.hookEventName;
  const error = input.error as { message?: string } | undefined;
  const payload: Record<string, unknown> = {
    ...input,
    agent_type: input.agentName,
    hook_event_name: event,
    permission_mode: input.mode,
    session_id: input.sessionId,
    transcript_path: TRANSCRIPT,
    transcriptPath: TRANSCRIPT,
    ...("toolName" in input
      ? { tool_name: input.toolName, tool_input: input.toolInput, tool_use_id: input.toolCallId }
      : {}),
    ...(event === "PermissionRequest" ? { permission_suggestions: input.permissionSuggestions } : {}),
    ...(event === "PostToolUse" ? { tool_response: input.toolResponse } : {}),
    ...(event === "PostToolUseFailure"
      ? { error_details: input.error, error: error?.message, is_interrupt: input.isInterrupt }
      : {}),
    ...(event === "Stop"
      ? { last_assistant_message: input.responseText ?? input.responsePreview, stop_hook_active: input.stopHookActive }
      : {})
  };
  return Object.fromEntries(Object.entries(payload).filter(([, value]) => value !== undefined));
}

const scope = {
  cwd: "/u/me/work",
  mode: "default",
  sessionId: "ses_zc01",
  timestamp: "2026-11-01T10:00:00.000Z",
  traceId: "trace-zc01",
  turnId: "turn-zc01"
};
const identity = { agent: "zcode", sessionId: scope.sessionId, cwd: scope.cwd, turnId: scope.turnId } as const;
const shell = { toolCallId: "call_1", toolInput: { command: "npm test" }, toolName: "Bash" };
const risk = { riskLevel: "medium", sideEffectScope: "workspace" };
const tool = { name: "Bash", callId: "call_1" };

function sample(
  input: Readonly<Record<string, unknown>> & { hookEventName: string },
  expected: Omit<LifecycleEvent, "agent" | "nativeEvent" | "sessionId" | "cwd" | "turnId">
): HookDialectSample {
  return {
    name: input.hookEventName,
    payload: zcodePayload(input),
    expected: { ...identity, nativeEvent: input.hookEventName, ...expected }
  };
}

export const zcodeSamples: readonly HookDialectSample[] = [
  sample(
    { ...scope, agentName: "build", hookEventName: "SessionStart", model: "zai/glm-5", source: "startup" },
    { phase: "start", scope: "session" }
  ),
  sample(
    { ...scope, agentName: "build", attachmentsSummary: [], hookEventName: "UserPromptSubmit", prompt: "add a test" },
    { phase: "start", scope: "turn" }
  ),
  sample({ ...scope, ...shell, ...risk, hookEventName: "PreToolUse" }, { phase: "activity", tool }),
  sample(
    { ...scope, ...shell, ...risk, hookEventName: "PermissionRequest", reason: "Tool Bash requires approval", requestId: "perm-1" },
    { phase: "blocked", blocker: "permission", tool }
  ),
  sample(
    { ...scope, ...shell, hookEventName: "PostToolUse", toolResponse: { output: "ok" }, toolResultPreview: "ok" },
    { phase: "activity", tool }
  ),
  sample(
    {
      ...scope,
      ...shell,
      error: { message: "exit 1", type: "ToolExecutionFailed" },
      hookEventName: "PostToolUseFailure",
      isInterrupt: false
    },
    { phase: "activity", tool }
  ),
  sample(
    {
      ...scope,
      agentName: "build",
      hookEventName: "Stop",
      responsePreview: "Done.",
      responseText: "Done.",
      stopHookActive: false,
      toolCallCount: 1
    },
    { phase: "finish", scope: "turn", outcome: "completed" }
  )
];
