import type { HookDialect, HookOutput } from "../../domain/lifecycle/index.js";

// https://docs.x.ai/build/features/hooks and the fuller user guide in the source,
// https://github.com/xai-org/grok-build/blob/2bdd1d6/crates/codegen/xai-grok-pager/docs/user-guide/10-hooks.md
// (events, payload, ordering, exit codes), with crates/codegen/xai-grok-hooks/src/event.rs (wire names, keys) and
// src/discovery.rs (which files load).

/** Observe-only events ignore stdout; failures, timeouts and malformed output fail open. */
const OUTPUT: HookOutput = {
  emptyStdout: "proceed",
  invalidStdout: "proceed",
  exitCode2: "block",
  otherExitCodes: "hook-failed",
  passThrough: "{}"
};

const camel = (name: string) => name.charAt(0).toLowerCase() + name.slice(1);

/** Claude Code event names Grok knows; the others, such as PermissionRequest, are skipped. */
const CLAUDE_EVENTS = [
  "SessionStart",
  "UserPromptSubmit",
  "PreToolUse",
  "PostToolUse",
  "PostToolUseFailure",
  "PermissionDenied",
  "Notification",
  "SubagentStart",
  "SubagentStop",
  "Stop",
  "StopFailure",
  "PreCompact",
  "PostCompact",
  "SessionEnd"
];

export const grokHookDialect: HookDialect = {
  specificationVersion: "harness-v1",
  agent: "grok",
  delivery: "command",
  // Seconds. 5 for most events in the public docs; newer source raises Stop, SubagentStop and PostToolUse to 600,
  // UserPromptSubmit to 30, and gives SessionEnd 1.5 s.
  timeout: { unit: "seconds", default: 5 },
  // Project hooks (including project Claude and Cursor files) load only in a trusted folder; no per-hook review.
  trust: { review: "workspace" },
  output: OUTPUT,
  fields: {
    // camelCase keys are authoritative. hookEventName carries the snake_case wire name; newer builds add
    // snake_case copies of some keys, with hook_event_name in PascalCase.
    event: { paths: [["hookEventName"], ["hook_event_name"]], env: ["GROK_HOOK_EVENT"] },
    // Inside a subagent this is the subagent's own session.
    sessionId: { paths: [["sessionId"], ["session_id"]], env: ["GROK_SESSION_ID"] },
    cwd: { paths: [["cwd"]] },
    // The session's ACP update log, not a Claude Code transcript.
    transcriptPath: { paths: [["transcriptPath"], ["transcript_path"]] },
    // Opaque; on prompt and turn-end events only, not on tool events.
    turnId: { paths: [["promptId"]] },
    subagentId: { paths: [["subagentId"]] },
    subagentType: { paths: [["subagentType"]] },
    // Events from inside a subagent carry subagentType ("exit early when subagentType is present").
    subagentMarker: { paths: [["subagentType"], ["subagentId"]] },
    toolName: { paths: [["toolName"], ["tool_name"]] },
    toolCallId: { paths: [["toolUseId"], ["tool_use_id"]] }
  },
  events: {
    SessionStart: { lifecycle: { phase: "start", scope: "session" }, aliases: ["session_start"] },
    UserPromptSubmit: { lifecycle: { phase: "start", scope: "turn" }, aliases: ["user_prompt_submit"] },
    PreToolUse: {
      lifecycle: { phase: "activity" },
      aliases: ["pre_tool_use"],
      gate: true,
      // A JSON deny wins whatever the exit code; empty, non-JSON or decision-less output is not a block.
      output: { ...OUTPUT, fields: ["decision", "reason", "hookSpecificOutput"] }
    },
    PostToolUse: { lifecycle: { phase: "activity" }, aliases: ["post_tool_use"] },
    PostToolUseFailure: { lifecycle: { phase: "activity" }, aliases: ["post_tool_use_failure"] },
    PermissionDenied: { lifecycle: { phase: "activity" }, aliases: ["permission_denied"] },
    Notification: {
      // There is no permission-request event; a pending prompt is a permission_prompt notification.
      lifecycle: {
        field: ["notificationType"],
        cases: {
          permission_prompt: { phase: "blocked", blocker: "permission" },
          idle_prompt: { phase: "finish", scope: "turn" }
        },
        otherwise: { phase: "unknown" }
      },
      aliases: ["notification"]
    },
    SubagentStart: { lifecycle: { phase: "start" }, subagent: true, aliases: ["subagent_start"] },
    SubagentStop: { lifecycle: { phase: "finish" }, subagent: true, aliases: ["subagent_stop"] },
    // At most one of Stop, StopFailure and StopCancelled per turn. A second Stop without promptId reports the
    // session closing.
    Stop: {
      lifecycle: {
        field: ["reason"],
        cases: {
          end_turn: { phase: "finish", scope: "turn", outcome: "completed" },
          channel_closed: { phase: "finish", scope: "session" },
          shutdown: { phase: "finish", scope: "session" }
        },
        otherwise: { phase: "finish", scope: "turn" }
      },
      aliases: ["stop"]
    },
    StopFailure: { lifecycle: { phase: "finish", scope: "turn", outcome: "failed" }, aliases: ["stop_failure"] },
    // Interrupts, declined or dismissed permission prompts, max_turns, no_progress.
    StopCancelled: {
      lifecycle: { phase: "finish", scope: "turn", outcome: "cancelled" },
      aliases: ["stop_cancelled"]
    },
    PreCompact: { lifecycle: { phase: "activity" }, aliases: ["pre_compact"] },
    PostCompact: { lifecycle: { phase: "activity" }, aliases: ["post_compact"] },
    SessionEnd: { lifecycle: { phase: "finish", scope: "session" }, aliases: ["session_end"] }
  },
  runsHooksOf: [
    {
      agent: "claude-code",
      // `[compat.claude] hooks = false` or GROK_CLAUDE_HOOKS_ENABLED turns this off.
      files: [
        "~/.claude/settings.json",
        "~/.claude/settings.local.json",
        ".claude/settings.json",
        ".claude/settings.local.json"
      ],
      byDefault: true,
      events: Object.fromEntries(CLAUDE_EVENTS.map((name) => [name, name]))
    },
    {
      agent: "cursor",
      // `[compat.cursor] hooks = false` or GROK_CURSOR_HOOKS_ENABLED turns this off.
      files: ["~/.cursor/hooks.json", ".cursor/hooks.json"],
      byDefault: true,
      events: {
        ...Object.fromEntries(
          [
            "SessionStart",
            "PreToolUse",
            "PostToolUse",
            "PostToolUseFailure",
            "SubagentStart",
            "SubagentStop",
            "PreCompact",
            "SessionEnd"
          ].map((name) => [camel(name), name])
        ),
        stop: "Stop",
        beforeSubmitPrompt: "UserPromptSubmit",
        beforeShellExecution: "PreToolUse",
        beforeMCPExecution: "PreToolUse",
        beforeReadFile: "PreToolUse",
        afterShellExecution: "PostToolUse",
        afterMCPExecution: "PostToolUse",
        afterFileEdit: "PostToolUse",
        afterAgentResponse: "PostToolUse",
        afterAgentThought: "PostToolUse"
      }
    }
  ]
};
