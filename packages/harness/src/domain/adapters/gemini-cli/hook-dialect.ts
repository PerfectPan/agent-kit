import type { HookDialect, HookOutput } from "../../lifecycle/index.js";

// https://github.com/google-gemini/gemini-cli/blob/main/docs/hooks/reference.md and docs/hooks/index.md (events,
// input and output, exit codes, environment). Where they are silent or disagree, checked against
// packages/core/src/hooks at ef59c53.

/**
 * stdout is read as JSON, falling back to stderr when stdout is empty; empty stdout and stderr decide nothing.
 * Plain text with exit 0 allows and is shown as a system message. Exit 2 blocks.
 */
const OUTPUT: HookOutput = {
  emptyStdout: "proceed",
  invalidStdout: "proceed",
  plainStdout: "shown",
  exitCode2: "block",
  otherExitCodes: "block",
  fields: ["continue", "stopReason", "suppressOutput", "systemMessage", "decision", "reason", "hookSpecificOutput"],
  passThrough: "{}",
  // A hook that fails to launch prints its error on stderr, which this rule turns into a deny.
  unverified:
    "The docs call other exit codes a warning; the source warns on exit 1 and turns plain text with any other " +
    "non-zero code into a deny."
};

export const geminiCliHookDialect: HookDialect = {
  specificationVersion: "harness-v1",
  agent: "gemini-cli",
  delivery: "command",
  // Milliseconds, default 60000. `gemini hooks migrate --from-claude` copies Claude's seconds unchanged.
  timeout: { unit: "milliseconds", default: 60_000 },
  // Settings hooks are skipped in an untrusted folder; a new or changed hook (keyed by name and command) warns once
  // and then runs.
  trust: { review: "workspace" },
  output: OUTPUT,
  fields: {
    event: { paths: [["hook_event_name"]] },
    sessionId: { paths: [["session_id"]], env: ["GEMINI_SESSION_ID"] },
    cwd: { paths: [["cwd"]], env: ["GEMINI_CWD"] },
    // An empty string when the session is not recorded.
    transcriptPath: { paths: [["transcript_path"]] },
    // No turn, prompt or tool call id reaches hooks.
    toolName: { paths: [["tool_name"]] }
  },
  // The complete list; Claude Code's names are rejected as invalid (agent-presence#86).
  events: {
    SessionStart: { lifecycle: { phase: "start", scope: "session" } },
    BeforeAgent: { lifecycle: { phase: "start", scope: "turn" } },
    BeforeModel: { lifecycle: { phase: "activity" } },
    // Fires for every response chunk.
    AfterModel: { lifecycle: { phase: "activity" } },
    BeforeToolSelection: { lifecycle: { phase: "activity" } },
    BeforeTool: { lifecycle: { phase: "activity" }, gate: true, output: OUTPUT },
    AfterTool: { lifecycle: { phase: "activity" } },
    PreCompress: { lifecycle: { phase: "activity" } },
    Notification: {
      // ToolPermission, sent when a tool needs the user's confirmation, is the only type.
      lifecycle: {
        field: ["notification_type"],
        cases: { ToolPermission: { phase: "blocked", blocker: "permission" } },
        otherwise: { phase: "unknown" }
      }
    },
    // End of a turn, with no reason or interrupt flag.
    AfterAgent: { lifecycle: { phase: "finish", scope: "turn" } },
    SessionEnd: { lifecycle: { phase: "finish", scope: "session" } }
  }
};
