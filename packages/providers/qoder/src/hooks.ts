import { QODER_ID } from "./facts.js";
import { type HookDialect, type HookOutput } from "@rivus/agent-kit-harness/spi";

// Hook facts from the agent SDK's protocol types (npm `@qoder-ai/qoder-agent-sdk`, dist/types/hooks.d.ts): the
// Claude-Code-shaped snake_case payload (`hook_event_name`, `session_id`, `cwd`, `transcript_path`, `tool_name`,
// `tool_use_id`, `tool_input`, `tool_response`, `permission_mode`, `prompt`), decisions `allow|deny|ask|defer`, and
// the SDK's event list. Exit-code semantics follow Claude Code's, which the CLI's hooks migrate command targets.

const OUTPUT: HookOutput = {
  emptyStdout: "proceed",
  invalidStdout: "proceed",
  exitCode2: "block",
  otherExitCodes: "hook-failed",
  passThrough: "{}",
  unverified: "the CLI's exit-code table is not published; these follow the Claude Code shapes it migrates from"
};

const OUTPUT_WITH_CONTEXT: HookOutput = { ...OUTPUT, plainStdout: "context" };

export const qoderHookDialect: HookDialect = {
  specificationVersion: "harness-v1",
  agent: QODER_ID,
  delivery: "command",
  // Seconds, as Claude Code's settings carry them.
  timeout: { unit: "seconds", default: 600 },
  output: OUTPUT,
  fields: {
    event: { paths: [["hook_event_name"]] },
    sessionId: { paths: [["session_id"]] },
    cwd: { paths: [["cwd"]] },
    transcriptPath: { paths: [["transcript_path"]] },
    // The user prompt being processed, absent until the first input; it is the turn.
    turnId: { paths: [["prompt"]] },
    toolName: { paths: [["tool_name"]] },
    toolCallId: { paths: [["tool_use_id"]] },
    subagentId: { paths: [["agent_id"]] },
    subagentType: { paths: [["agent_type"]] }
  },
  events: {
    SessionStart: {
      lifecycle: {
        field: ["source"],
        cases: { compact: { phase: "activity" } },
        otherwise: { phase: "start", scope: "session" }
      },
      output: OUTPUT_WITH_CONTEXT
    },
    SessionEnd: { lifecycle: { phase: "finish", scope: "session" } },
    UserPromptSubmit: { lifecycle: { phase: "start", scope: "turn" }, output: OUTPUT_WITH_CONTEXT },
    PreToolUse: {
      lifecycle: { phase: "activity" },
      gate: true,
      output: {
        ...OUTPUT,
        fields: [
          "continue",
          "stopReason",
          "suppressOutput",
          "systemMessage",
          "hookSpecificOutput",
          "decision",
          "reason"
        ]
      }
    },
    PermissionRequest: {
      lifecycle: { phase: "blocked", blocker: "permission" },
      gate: true,
      output: {
        ...OUTPUT,
        exitCode2: "proceed",
        fields: ["continue", "stopReason", "systemMessage", "hookSpecificOutput"]
      }
    },
    PermissionDenied: { lifecycle: { phase: "activity" } },
    PostToolUse: { lifecycle: { phase: "activity" } },
    PostToolUseFailure: { lifecycle: { phase: "activity" } },
    SubagentStart: { lifecycle: { phase: "start" }, subagent: true },
    SubagentStop: { lifecycle: { phase: "finish" }, subagent: true },
    Stop: { lifecycle: { phase: "finish", scope: "turn", outcome: "completed" } },
    PreCompact: { lifecycle: { phase: "activity" } },
    PostCompact: { lifecycle: { phase: "activity" } },
    // Qoder-specific observations the SDK exposes beside Claude Code's set.
    InstructionsLoaded: { lifecycle: { phase: "activity" } },
    WorktreeCreate: { lifecycle: { phase: "activity" } },
    WorktreeRemove: { lifecycle: { phase: "activity" } },
    CwdChanged: { lifecycle: { phase: "activity" } },
    FileChanged: { lifecycle: { phase: "activity" } }
  }
};
