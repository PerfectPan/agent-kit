import type { HookDialect, HookOutput } from "../../domain/lifecycle/index.js";

// https://developers.openai.com/codex/hooks (redirects to https://learn.chatgpt.com/docs/hooks): events, input and
// output fields, exit codes, trust. Plugin-bundled hooks: https://developers.openai.com/plugins/build/plugins.
// Behavior the docs leave open is checked against github.com/openai/codex at 95ec468, codex-rs/hooks.

/** Fields of the common JSON output; only some events accept them. */
const COMMON_FIELDS = ["continue", "stopReason", "systemMessage", "suppressOutput"];

/**
 * Exit 0 with empty stdout succeeds. Stdout that starts with `{` or `[` but does not parse, or JSON with a field
 * the event does not support, marks the hook run failed and the operation continues. Exit 2 with a reason on
 * stderr blocks where the event can block; any other exit code, a timeout or a spawn error fails open.
 */
const OUTPUT: HookOutput = {
  emptyStdout: "proceed",
  invalidStdout: "hook-failed",
  exitCode2: "block",
  otherExitCodes: "hook-failed",
  fields: COMMON_FIELDS,
  passThrough: "{}"
};

export const codexHookDialect: HookDialect = {
  specificationVersion: "harness-v1",
  agent: "codex",
  delivery: "command",
  // Seconds, default 600, at least 1. SessionEnd and Interrupt default to 1 s and are clamped to 1–3 s.
  timeout: { unit: "seconds", default: 600 },
  // Trust is recorded against a hash of the normalized hook definition (event, matcher, handler with its command
  // and timeout), so changing the command asks again; the script it points to is not hashed.
  trust: { review: "content-hash" },
  output: OUTPUT,
  fields: {
    event: { paths: [["hook_event_name"]] },
    // Subagent hooks get the parent's session id. Codex sets no session variable for hooks.
    sessionId: { paths: [["session_id"]] },
    cwd: { paths: [["cwd"]] },
    transcriptPath: { paths: [["transcript_path"]] },
    // On every turn-scoped event; a time-ordered UUIDv7 in the source, opaque per the docs.
    turnId: { paths: [["turn_id"]] },
    subagentId: { paths: [["agent_id"]] },
    subagentType: { paths: [["agent_type"]] },
    toolName: { paths: [["tool_name"]] },
    toolCallId: { paths: [["tool_use_id"]] }
  },
  events: {
    SessionStart: {
      lifecycle: {
        field: ["source"],
        cases: { compact: { phase: "activity" } },
        otherwise: { phase: "start", scope: "session" }
      }
    },
    UserPromptSubmit: { lifecycle: { phase: "start", scope: "turn" } },
    PreToolUse: {
      lifecycle: { phase: "activity" },
      gate: true,
      // continue:false, stopReason and suppressOutput:true are not supported here: the run is marked failed and
      // the tool call continues.
      output: { ...OUTPUT, fields: ["systemMessage", "hookSpecificOutput", "decision", "reason"] }
    },
    PermissionRequest: {
      lifecycle: { phase: "blocked", blocker: "permission" },
      gate: true,
      output: {
        ...OUTPUT,
        fields: ["systemMessage", "hookSpecificOutput"],
        unverified: "Exit code 2 denies in the source; the docs do not say."
      }
    },
    PostToolUse: {
      lifecycle: { phase: "activity" },
      output: {
        ...OUTPUT,
        fields: ["continue", "stopReason", "systemMessage", "decision", "reason", "hookSpecificOutput"]
      }
    },
    PreCompact: { lifecycle: { phase: "activity" } },
    PostCompact: { lifecycle: { phase: "activity" } },
    SubagentStart: { lifecycle: { phase: "start" }, subagent: true },
    SubagentStop: { lifecycle: { phase: "finish" }, subagent: true },
    // Stop carries no reason; an interrupted turn fires Interrupt instead.
    Stop: { lifecycle: { phase: "finish", scope: "turn" } },
    Interrupt: {
      lifecycle: { phase: "finish", scope: "turn", outcome: "cancelled" },
      output: { ...OUTPUT, exitCode2: "proceed", fields: ["systemMessage"] }
    },
    SessionEnd: { lifecycle: { phase: "finish", scope: "session" }, output: { ...OUTPUT, exitCode2: "proceed" } }
  }
};
