import type { HookDialect, HookOutput } from "../index.js";

// https://cursor.com/docs/hooks (events, input and output schemas, exit codes, environment) and
// https://cursor.com/docs/reference/third-party-hooks (loading Claude Code hooks, event mapping).

/** Exit 0 uses the JSON output, exit 2 denies, other exit codes fail open unless the hook sets `failClosed`. */
const OUTPUT: HookOutput = {
  emptyStdout: "proceed",
  invalidStdout: "undocumented",
  exitCode2: "block",
  otherExitCodes: "proceed",
  passThrough: "{}",
  unverified:
    "The docs only say that exit code 0 uses the JSON output; empty or invalid output of an observing hook is undocumented."
};

/**
 * A permission hook: with exit code 0, invalid JSON or a response that does not match the event's schema blocks
 * the action, even without `failClosed`. Whether empty stdout counts as invalid is undocumented
 * (agent-presence#89). `{}` is what an observer prints: Cursor staff confirm it passes validation as "no opinion"
 * (forum.cursor.com/t/hooks-no-longer-accept-null-and-failed-closed/160617), it is valid for Claude Code too, and
 * unlike `{"permission":"allow"}` it never approves anything.
 */
function gate(fields: readonly string[]): HookOutput {
  return {
    emptyStdout: "undocumented",
    invalidStdout: "block",
    exitCode2: "block",
    otherExitCodes: "proceed",
    fields,
    passThrough: "{}",
    unverified:
      "The schema lists `permission` without marking it optional, and the docs do not say whether empty stdout " +
      "is invalid JSON; forum answers from Cursor staff treat both `{}` and empty output as allow."
  };
}

export const cursorHookDialect: HookDialect = {
  specificationVersion: "harness-v1",
  agent: "cursor",
  delivery: "command",
  timeout: { unit: "seconds", unverified: "The default is only called the platform default." },
  // Project hooks run only in a trusted workspace; there is no per-hook review.
  trust: { review: "workspace" },
  output: OUTPUT,
  fields: {
    event: { paths: [["hook_event_name"]] },
    // session_id equals conversation_id where both are sent. Tool events sometimes carry them blank.
    sessionId: { paths: [["conversation_id"], ["session_id"]] },
    // Only shell and tool events carry cwd; every event carries the workspace roots.
    cwd: { paths: [["cwd"], ["workspace_roots", "0"]] },
    transcriptPath: { paths: [["transcript_path"]], env: ["CURSOR_TRANSCRIPT_PATH"] },
    turnId: { paths: [["generation_id"]] },
    subagentId: { paths: [["subagent_id"]] },
    subagentType: { paths: [["subagent_type"]] },
    toolName: { paths: [["tool_name"]] },
    toolCallId: { paths: [["tool_use_id"]] }
  },
  events: {
    // Fire-and-forget: the agent does not wait for or enforce the response.
    sessionStart: { lifecycle: { phase: "start", scope: "session" } },
    beforeSubmitPrompt: {
      lifecycle: { phase: "start", scope: "turn" },
      output: { ...OUTPUT, fields: ["continue", "user_message"], passThrough: '{"continue":true}' }
    },
    preToolUse: {
      lifecycle: { phase: "activity" },
      gate: true,
      output: gate(["permission", "user_message", "agent_message", "updated_input"])
    },
    beforeShellExecution: {
      lifecycle: { phase: "activity" },
      gate: true,
      output: gate(["permission", "user_message", "agent_message"])
    },
    beforeMCPExecution: {
      lifecycle: { phase: "activity" },
      gate: true,
      output: gate(["permission", "user_message", "agent_message"])
    },
    beforeReadFile: { lifecycle: { phase: "activity" }, gate: true, output: gate(["permission", "user_message"]) },
    // Tab completion, not the agent: kept for its gate semantics only.
    beforeTabFileRead: { lifecycle: { phase: "unknown" }, gate: true, output: gate(["permission"]) },
    postToolUse: { lifecycle: { phase: "activity" } },
    // Also fires when a tool times out or is denied.
    postToolUseFailure: { lifecycle: { phase: "activity" } },
    afterShellExecution: { lifecycle: { phase: "activity" } },
    afterMCPExecution: { lifecycle: { phase: "activity" } },
    afterFileEdit: { lifecycle: { phase: "activity" } },
    afterAgentResponse: { lifecycle: { phase: "activity" } },
    afterAgentThought: { lifecycle: { phase: "activity" } },
    preCompact: { lifecycle: { phase: "activity" } },
    subagentStart: {
      lifecycle: { phase: "start" },
      subagent: true,
      gate: true,
      // `ask` is treated as deny here.
      output: gate(["permission", "user_message"])
    },
    subagentStop: {
      lifecycle: {
        field: ["status"],
        cases: {
          completed: { phase: "finish", outcome: "completed" },
          error: { phase: "finish", outcome: "failed" },
          aborted: { phase: "finish", outcome: "cancelled" }
        },
        otherwise: { phase: "finish" }
      },
      subagent: true
    },
    stop: {
      lifecycle: {
        field: ["status"],
        cases: {
          completed: { phase: "finish", scope: "turn", outcome: "completed" },
          error: { phase: "finish", scope: "turn", outcome: "failed" },
          aborted: { phase: "finish", scope: "turn", outcome: "cancelled" }
        },
        otherwise: { phase: "finish", scope: "turn" }
      }
    },
    sessionEnd: { lifecycle: { phase: "finish", scope: "session" } }
  },
  runsHooksOf: [
    {
      agent: "claude-code",
      // "Include Third-Party Plugins, Skills, and Other Configs" in the editor, on by default; the CLI always loads
      // them. Claude Code's SubagentStart, Notification and PermissionRequest have no Cursor event.
      files: ["~/.claude/settings.json", ".claude/settings.json", ".claude/settings.local.json"],
      byDefault: true,
      events: {
        SessionStart: "sessionStart",
        UserPromptSubmit: "beforeSubmitPrompt",
        PreToolUse: "preToolUse",
        PostToolUse: "postToolUse",
        PreCompact: "preCompact",
        SubagentStop: "subagentStop",
        Stop: "stop",
        SessionEnd: "sessionEnd"
      },
      unverified:
        "Which keys a Claude Code hook receives is undocumented; forum reports show Cursor's (cursor_version)."
    }
  ]
};
