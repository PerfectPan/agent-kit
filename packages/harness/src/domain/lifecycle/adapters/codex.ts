import type { HookDialect, HookOutput } from "../index.js";

// https://developers.openai.com/codex/hooks (redirects to https://learn.chatgpt.com/docs/hooks): events, input and
// output fields, exit codes, trust. Plugin-bundled hooks: https://developers.openai.com/plugins/build/plugins.
// Behavior the docs leave open is checked against github.com/openai/codex at 95ec468, codex-rs/hooks.

/** The common JSON output fields, accepted by SessionStart, PreCompact, PostCompact, UserPromptSubmit, SubagentStop and Stop. */
const COMMON_FIELDS = ["continue", "stopReason", "systemMessage", "suppressOutput"];

/**
 * Exit 0 with empty stdout succeeds. Stdout that starts with `{` or `[` but does not parse, or JSON with a field
 * the event does not support, marks the hook run failed and the operation continues. Exit 2 with a reason on
 * stderr blocks where the event can block; any other exit code, a timeout or a spawn error fails open. Which JSON
 * fields an event accepts, and what plain text does, differ per event.
 */
const OUTPUT: HookOutput = {
  emptyStdout: "proceed",
  invalidStdout: "hook-failed",
  exitCode2: "block",
  otherExitCodes: "hook-failed",
  passThrough: "{}"
};

/** Plain text on stdout becomes developer context here, so an observer prints nothing. */
const CONTEXT_OUTPUT: HookOutput = { ...OUTPUT, plainStdout: "context", passThrough: "" };

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
      },
      output: { ...CONTEXT_OUTPUT, fields: [...COMMON_FIELDS, "hookSpecificOutput"] }
    },
    UserPromptSubmit: {
      lifecycle: { phase: "start", scope: "turn" },
      output: { ...CONTEXT_OUTPUT, fields: [...COMMON_FIELDS, "decision", "reason", "hookSpecificOutput"] }
    },
    PreToolUse: {
      lifecycle: { phase: "activity" },
      gate: true,
      // continue:false, stopReason and suppressOutput:true are not supported here: the run is marked failed and
      // the tool call continues.
      output: { ...OUTPUT, fields: ["systemMessage", "hookSpecificOutput", "decision", "reason"] }
    },
    // Runs when Codex is about to ask the user for approval, also on behalf of a subagent (with agent_id), so the
    // main session waits on the user too.
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
    PreCompact: { lifecycle: { phase: "activity" }, output: { ...OUTPUT, fields: COMMON_FIELDS } },
    PostCompact: { lifecycle: { phase: "activity" }, output: { ...OUTPUT, fields: COMMON_FIELDS } },
    // continue:false does not stop the subagent from starting.
    SubagentStart: {
      lifecycle: { phase: "start" },
      subagent: true,
      output: { ...CONTEXT_OUTPUT, fields: ["systemMessage", "hookSpecificOutput"] }
    },
    SubagentStop: {
      lifecycle: { phase: "finish" },
      subagent: true,
      output: { ...OUTPUT, fields: [...COMMON_FIELDS, "decision", "reason"] }
    },
    // Stop carries no reason; an interrupted turn fires Interrupt instead.
    Stop: {
      lifecycle: { phase: "finish", scope: "turn" },
      output: { ...OUTPUT, fields: [...COMMON_FIELDS, "decision", "reason"] }
    },
    Interrupt: {
      lifecycle: { phase: "finish", scope: "turn", outcome: "cancelled" },
      output: { ...OUTPUT, exitCode2: "proceed", fields: ["systemMessage"] }
    },
    SessionEnd: { lifecycle: { phase: "finish", scope: "session" }, output: { ...OUTPUT, exitCode2: "proceed" } }
  }
};
