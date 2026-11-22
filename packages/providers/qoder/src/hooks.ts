import { QODER_ID } from "./facts.js";
import {
  claudeShapedCoreEvents,
  claudeShapedFields,
  claudeShapedHookOutput,
  claudeShapedSecondsTimeout,
  claudeShapedSessionStartLifecycle,
  withPlainStdoutContext,
  type HookDialect,
  type HookOutput
} from "@rivus/agent-kit-harness/spi";

// Hook facts from the agent SDK's protocol types (npm `@qoder-ai/qoder-agent-sdk`, dist/types/hooks.d.ts): the
// Claude-Code-shaped snake_case payload (`hook_event_name`, `session_id`, `cwd`, `transcript_path`, `tool_name`,
// `tool_use_id`, `tool_input`, `tool_response`, `permission_mode`, `prompt`), decisions `allow|deny|ask|defer`, and
// the SDK's event list. Exit-code semantics follow Claude Code's, which the CLI's hooks migrate command targets.

const OUTPUT: HookOutput = {
  ...claudeShapedHookOutput,
  unverified: "the CLI's exit-code table is not published; these follow the Claude Code shapes it migrates from"
};

const OUTPUT_WITH_CONTEXT: HookOutput = withPlainStdoutContext(OUTPUT);

export const qoderHookDialect: HookDialect = {
  specificationVersion: "harness-v1",
  agent: QODER_ID,
  delivery: "command",
  // Seconds, as Claude Code's settings carry them.
  timeout: claudeShapedSecondsTimeout,
  output: OUTPUT,
  fields: { ...claudeShapedFields },
  events: {
    SessionStart: {
      lifecycle: claudeShapedSessionStartLifecycle,
      output: OUTPUT_WITH_CONTEXT
    },
    SessionEnd: { lifecycle: { phase: "finish", scope: "session" } },
    ...claudeShapedCoreEvents(OUTPUT),
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
