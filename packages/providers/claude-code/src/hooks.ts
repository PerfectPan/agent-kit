import { CLAUDE_CODE_ID, CLAUDE_CODE_SESSION_ENV } from "./facts.js";
import {
  claudeShapedCoreEvents,
  claudeShapedFields,
  claudeShapedHookOutput,
  claudeShapedSecondsTimeout,
  claudeShapedSessionId,
  claudeShapedSessionStartLifecycle,
  claudeShapedTurnId,
  withPlainStdoutContext,
  type HookDialect,
  type HookOutput
} from "@rivus/agent-kit-harness/spi";

// https://code.claude.com/docs/en/hooks (events, input fields, exit codes, JSON output, timeouts) and
// https://code.claude.com/docs/en/env-vars (CLAUDE_CODE_SESSION_ID). Hooks also live in a skills-dir plugin's
// hooks/hooks.json (https://code.claude.com/docs/en/plugins-reference#hooks).

/**
 * Exit 0 with empty stdout makes no decision and the flow continues; stdout is JSON only when it starts with `{`
 * and ends with `}`, otherwise plain text. Exit 2 blocks the events that can block. Any other code is a
 * non-blocking error. `{}` is valid output for every event, and for the agents that run these hooks too.
 */
const OUTPUT: HookOutput = { ...claudeShapedHookOutput };

export const claudeCodeHookDialect: HookDialect = {
  specificationVersion: "harness-v1",
  agent: CLAUDE_CODE_ID,
  delivery: "command",
  // Seconds; 600 for command hooks, 30 on UserPromptSubmit. All SessionEnd hooks share 1.5 s, raised to the
  // highest timeout in the settings files, at most 60 s.
  timeout: claudeShapedSecondsTimeout,
  // Interactive sessions hold back every settings hook until the folder's trust dialog is accepted; there is no
  // per-hook review.
  trust: { review: "workspace" },
  output: OUTPUT,
  fields: {
    ...claudeShapedFields,
    sessionId: claudeShapedSessionId([CLAUDE_CODE_SESSION_ENV]),
    // The user prompt being processed, absent until the first input; it is the turn.
    turnId: claudeShapedTurnId()
  },
  events: {
    SessionStart: {
      // `compact` fires after a compaction inside a running session.
      lifecycle: claudeShapedSessionStartLifecycle,
      // Plain-text stdout becomes context for Claude here; `{}` is JSON and adds nothing.
      output: withPlainStdoutContext(OUTPUT)
    },
    ...claudeShapedCoreEvents(OUTPUT),
    PostToolBatch: { lifecycle: { phase: "activity" } },
    Notification: {
      // permission_prompt arrives about 6 s after the dialog; idle_prompt about 60 s after Claude finished, which
      // also covers an interrupted turn that sent no Stop.
      lifecycle: {
        field: ["notification_type"],
        cases: {
          permission_prompt: { phase: "blocked", blocker: "permission" },
          elicitation_dialog: { phase: "blocked", blocker: "elicitation" },
          elicitation_url_dialog: { phase: "blocked", blocker: "elicitation" },
          elicitation_complete: { phase: "activity" },
          elicitation_response: { phase: "activity" },
          idle_prompt: { phase: "finish", scope: "turn" }
        },
        otherwise: { phase: "unknown" }
      }
    },
    SubagentStart: { lifecycle: { phase: "start" }, subagent: true },
    SubagentStop: { lifecycle: { phase: "finish" }, subagent: true },
    // Stop does not fire when the user interrupts; a turn that ends on an API error fires StopFailure instead.
    Stop: { lifecycle: { phase: "finish", scope: "turn", outcome: "completed" } },
    StopFailure: { lifecycle: { phase: "finish", scope: "turn", outcome: "failed" } },
    PreCompact: { lifecycle: { phase: "activity" } },
    PostCompact: { lifecycle: { phase: "activity" } },
    Elicitation: { lifecycle: { phase: "blocked", blocker: "elicitation" } },
    ElicitationResult: { lifecycle: { phase: "activity" } },
    SessionEnd: { lifecycle: { phase: "finish", scope: "session" } }
  }
};
