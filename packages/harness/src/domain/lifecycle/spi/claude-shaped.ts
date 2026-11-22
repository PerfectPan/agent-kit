import type {
  FieldSource,
  HookEventSpec,
  HookOutput,
  HookTimeout,
  LifecycleSwitch,
  PayloadFields
} from "./hook-dialect.js";

/**
 * The hook shapes the agents that follow Claude Code's convention share, as
 * factories instead of copies: a dialect declares "Claude-shaped" and names
 * only its own differences, so a drift in the shared shape is one edit. The
 * per-agent facts — event sets, timeouts, exit-code deviations — stay in each
 * provider's dialect, with their documentation.
 */

/** The exit-code table Claude Code documents and its followers copy. */
export const claudeShapedHookOutput: HookOutput = {
  emptyStdout: "proceed",
  invalidStdout: "proceed",
  exitCode2: "block",
  otherExitCodes: "hook-failed",
  passThrough: "{}"
};

/** The output table with the plain-text stdout a start-of-turn or session event turns into context. */
export const withPlainStdoutContext = (output: HookOutput): HookOutput => ({ ...output, plainStdout: "context" });

/** One Claude-shaped payload field: the JSON path the value is read from. */
export const claudeShapedField = (path: string): FieldSource => ({ paths: [[path]] });

/** The session id field with the agent's environment variable as a fallback. */
export const claudeShapedSessionId = (env: readonly string[]): FieldSource => ({
  paths: [["session_id"]],
  env
});

/** The turn id field when the payload names one (Claude Code's `prompt_id`, or the agent's own). */
export const claudeShapedTurnId = (path: string = "prompt_id"): FieldSource => claudeShapedField(path);

/** The payload fields every Claude-shaped stdin payload carries, keyed as the dialect spells them. */
export const claudeShapedFields: PayloadFields = {
  event: { paths: [["hook_event_name"]] },
  sessionId: { paths: [["session_id"]] },
  cwd: { paths: [["cwd"]] },
  transcriptPath: { paths: [["transcript_path"]] },
  toolName: { paths: [["tool_name"]] },
  toolCallId: { paths: [["tool_use_id"]] },
  subagentId: { paths: [["agent_id"]] },
  subagentType: { paths: [["agent_type"]] }
};

/** How a SessionStart carrying a `source` splits compaction from a fresh session start. */
export const claudeShapedSessionStartLifecycle: LifecycleSwitch = {
  field: ["source"],
  cases: { compact: { phase: "activity" } },
  otherwise: { phase: "start", scope: "session" }
};

/** The stdout JSON keys a gate decision (PreToolUse) may carry. */
export const claudeShapedGateFields: readonly string[] = [
  "continue",
  "stopReason",
  "suppressOutput",
  "systemMessage",
  "hookSpecificOutput",
  "decision",
  "reason"
];

/** The stdout JSON keys a permission decision may carry. */
export const claudeShapedPermissionFields: readonly string[] = [
  "continue",
  "stopReason",
  "systemMessage",
  "hookSpecificOutput"
];

/** Command-hook timeouts measured in seconds, as Claude Code's settings carry them. */
export const claudeShapedSecondsTimeout: HookTimeout = {
  unit: "seconds",
  default: 600
};

/** The core tool-and-prompt lifecycle events shared by Claude Code and its direct followers (e.g. Qoder). */
export function claudeShapedCoreEvents(output: HookOutput): Record<string, HookEventSpec> {
  return {
    UserPromptSubmit: { lifecycle: { phase: "start", scope: "turn" }, output: withPlainStdoutContext(output) },
    PreToolUse: {
      lifecycle: { phase: "activity" },
      gate: true,
      output: { ...output, fields: claudeShapedGateFields }
    },
    PermissionRequest: {
      lifecycle: { phase: "blocked", blocker: "permission" },
      gate: true,
      output: { ...output, exitCode2: "proceed", fields: claudeShapedPermissionFields }
    },
    PermissionDenied: { lifecycle: { phase: "activity" } },
    PostToolUse: { lifecycle: { phase: "activity" } },
    PostToolUseFailure: { lifecycle: { phase: "activity" } }
  };
}
