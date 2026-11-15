import { KIMI_CLIENT_TYPE_FIELD, KIMI_ID } from "./facts.js";
import { type HookDialect, type HookOutput } from "@rivus/agent-kit-harness/spi";

// https://www.kimi.com/code/docs/en/kimi-code-cli/customization/hooks.html (events, payload, exit codes, timeouts).
// The payload is Claude Code-shaped (snake_case fields on stdin); exit 0 allows, 2 blocks the blockable events, and
// every other outcome fails open — the CLI logs a failed hook and moves on.

const OUTPUT: HookOutput = {
  emptyStdout: "proceed",
  invalidStdout: "proceed",
  exitCode2: "block",
  // Fail-open: a script that errors, times out or exits with another code never blocks.
  otherExitCodes: "proceed",
  passThrough: "{}",
  unverified: "whether stdout JSON the event does not accept keeps the flow unchanged is not documented"
};

/** Events whose stdout may become context, per the guide's allow-continues-with-stdout rule. */
const OUTPUT_WITH_CONTEXT: HookOutput = { ...OUTPUT, plainStdout: "context" };

export const kimiHookDialect: HookDialect = {
  specificationVersion: "harness-v1",
  hostMarkers: { payloadFields: [KIMI_CLIENT_TYPE_FIELD] },
  agent: KIMI_ID,
  delivery: "command",
  // Seconds, 1–600 per rule; the guide's default is 30.
  timeout: { unit: "seconds", default: 30 },
  // Hook rules live only in the user config and local plugins, which the CLI runs without a review prompt.
  output: OUTPUT,
  fields: {
    event: { paths: [["hook_event_name"]] },
    sessionId: { paths: [["session_id"]] },
    turnId: { paths: [["turn_id"]] },
    cwd: { paths: [["cwd"]] },
    transcriptPath: { paths: [["transcript_path"]] },
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
    // A message queued while a turn runs; the payload carries prompt_id and prompt.
    UserPromptQueued: { lifecycle: { phase: "activity" } },
    UserPromptSubmit: { lifecycle: { phase: "start", scope: "turn" }, output: OUTPUT_WITH_CONTEXT },
    // The payload names the turn origin (user, task, system_trigger) and carries turn_id.
    TurnStarted: { lifecycle: { phase: "start", scope: "turn" } },
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
    PostToolUse: { lifecycle: { phase: "activity" } },
    PostToolUseFailure: { lifecycle: { phase: "activity" } },
    PermissionRequest: { lifecycle: { phase: "blocked", blocker: "permission" } },
    PermissionResult: { lifecycle: { phase: "activity" } },
    SessionEnd: { lifecycle: { phase: "finish", scope: "session" } },
    // Fires every 60 s while the session lives; only configured sessions run the timer.
    SessionHeartbeat: { lifecycle: { phase: "activity" } },
    SubagentStart: { lifecycle: { phase: "start" }, subagent: true },
    SubagentStop: { lifecycle: { phase: "finish" }, subagent: true },
    TaskStarted: { lifecycle: { phase: "activity" } },
    // A turn that fails on an error fires StopFailure instead of Stop.
    StopFailure: { lifecycle: { phase: "finish", scope: "turn", outcome: "failed" } },
    // Fires instead of Stop when the user interrupts.
    Interrupt: { lifecycle: { phase: "finish", scope: "turn" } },
    Stop: { lifecycle: { phase: "finish", scope: "turn", outcome: "completed" } },
    PreCompact: { lifecycle: { phase: "activity" } },
    PostCompact: { lifecycle: { phase: "activity" } },
    Notification: { lifecycle: { phase: "activity" } }
  }
};
