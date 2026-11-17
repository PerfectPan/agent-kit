import { DIM_ID } from "./facts.js";
import {
  claudeShapedField,
  claudeShapedHookOutput,
  claudeShapedPermissionFields,
  claudeShapedSessionStartLifecycle,
  type HookDialect,
  type HookOutput
} from "@rivus/agent-kit-harness/spi";

// Hook facts from the CLI itself (0.5.27): `hooks.json` in the data root or project `.dimcode/` holds the Claude
// Code grouped shape under a `hooks` key, the command events are the ten SUPPORTED_COMMAND_HOOK_EVENTS, the stdin
// payload is `hook_event_name, session_id, transcript_path, cwd, model, permission_mode, agent_id, run_id`, and exit
// code 2 blocks (BLOCK_EXIT_CODE). Hooks must be trusted through `dim hooks`, which reviews the file's content.

const OUTPUT: HookOutput = {
  ...claudeShapedHookOutput,
  otherExitCodes: "proceed",
  unverified: "what stdout JSON the CLI accepts, and what other exit codes do, is not documented"
};

export const dimHookDialect: HookDialect = {
  specificationVersion: "harness-v1",
  agent: DIM_ID,
  delivery: "command",
  // Seconds; the spec's `timeout` field, as Claude Code's.
  timeout: { unit: "seconds", default: 60 },
  // The CLI reviews command hooks itself (`dim hooks`), trusting the file's content hash.
  trust: { review: "content-hash" },
  output: OUTPUT,
  fields: {
    event: claudeShapedField("hook_event_name"),
    sessionId: claudeShapedField("session_id"),
    cwd: claudeShapedField("cwd"),
    transcriptPath: claudeShapedField("transcript_path")
    // The per-event tool fields are not documented; the guide's matcher subjects (tool, agenttype, trigger,
    // toolcall) say the payload names them, so they are mapped once a capture confirms the keys.
  },
  events: {
    SessionStart: { lifecycle: claudeShapedSessionStartLifecycle },
    UserPromptSubmit: { lifecycle: { phase: "start", scope: "turn" } },
    PreToolUse: {
      lifecycle: { phase: "activity" },
      gate: true,
      output: { ...OUTPUT, fields: claudeShapedPermissionFields }
    },
    PermissionRequest: { lifecycle: { phase: "blocked", blocker: "permission" } },
    PostToolUse: { lifecycle: { phase: "activity" } },
    PreCompact: { lifecycle: { phase: "activity" } },
    PostCompact: { lifecycle: { phase: "activity" } },
    SubagentStart: { lifecycle: { phase: "start" }, subagent: true },
    SubagentStop: { lifecycle: { phase: "finish" }, subagent: true },
    Stop: { lifecycle: { phase: "finish", scope: "turn", outcome: "completed" } }
  }
};
