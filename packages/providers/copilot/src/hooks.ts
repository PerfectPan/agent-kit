import type { HookDialect, HookOutput } from "@rivus/agent-kit-harness/spi";
import { COPILOT_HOOK_TIMEOUT_SECONDS, COPILOT_HOST_MARKER_ENV, COPILOT_ID } from "./facts.js";

// GitHub Copilot CLI lifecycle hooks (verified against 1.0.114):
// - User-level hook files live at `~/.copilot/hooks/*.json` (`{ "version": 1, "hooks": { ... } }`), alongside
//   repository-level `.github/hooks/*.json`.
// - Registering PascalCase event names (`SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse`,
//   `PostToolUseFailure`, `SubagentStart`, `SubagentStop`, `Stop`, `SessionEnd`) delivers snake_case JSON payloads on
//   stdin (`hook_event_name`, `session_id`, `cwd`, `transcript_path`, `tool_name`, `tool_use_id`, `stop_reason`), and
//   exports `COPILOT_CLI` in the hook process environment.

const OUTPUT: HookOutput = {
  emptyStdout: "proceed",
  invalidStdout: "proceed",
  exitCode2: "block",
  otherExitCodes: "proceed",
  passThrough: "{}"
};

const GATE_OUTPUT: HookOutput = {
  emptyStdout: "proceed",
  invalidStdout: "proceed",
  exitCode2: "block",
  otherExitCodes: "proceed",
  fields: ["permissionDecision", "permissionDecisionReason", "updatedInput"],
  passThrough: "{}"
};

export const copilotHookDialect: HookDialect = {
  specificationVersion: "harness-v1",
  hostMarkers: { env: [COPILOT_HOST_MARKER_ENV] },
  agent: COPILOT_ID,
  delivery: "command",
  timeout: { unit: "seconds", default: COPILOT_HOOK_TIMEOUT_SECONDS },
  output: OUTPUT,
  fields: {
    event: { paths: [["hook_event_name"]] },
    sessionId: { paths: [["session_id"], ["sessionId"]] },
    cwd: { paths: [["cwd"]] },
    transcriptPath: { paths: [["transcript_path"], ["transcriptPath"]] },
    toolName: { paths: [["tool_name"], ["toolName"]] },
    toolCallId: { paths: [["tool_use_id"], ["toolCallId"]] }
  },
  events: {
    SessionStart: {
      lifecycle: { phase: "start", scope: "session" }
    },
    UserPromptSubmit: {
      lifecycle: { phase: "start", scope: "turn" },
      gate: true,
      output: OUTPUT
    },
    PreToolUse: {
      lifecycle: { phase: "activity" },
      gate: true,
      output: GATE_OUTPUT
    },
    PostToolUse: {
      lifecycle: { phase: "activity" }
    },
    PostToolUseFailure: {
      lifecycle: { phase: "activity" }
    },
    SubagentStart: {
      lifecycle: { phase: "activity" }
    },
    SubagentStop: {
      lifecycle: { phase: "activity" }
    },
    Stop: {
      lifecycle: {
        field: ["stop_reason"],
        cases: {
          end_turn: { phase: "finish", scope: "turn", outcome: "completed" },
          max_tokens: { phase: "finish", scope: "turn", outcome: "completed" },
          error: { phase: "finish", scope: "turn", outcome: "failed" },
          cancelled: { phase: "finish", scope: "turn", outcome: "cancelled" }
        },
        otherwise: { phase: "finish", scope: "turn" }
      }
    },
    SessionEnd: {
      lifecycle: {
        field: ["reason"],
        cases: {
          complete: { phase: "finish", scope: "session", outcome: "completed" },
          error: { phase: "finish", scope: "session", outcome: "failed" },
          timeout: { phase: "finish", scope: "session", outcome: "failed" },
          abort: { phase: "finish", scope: "session", outcome: "cancelled" }
        },
        otherwise: { phase: "finish", scope: "session" }
      }
    }
  }
};
