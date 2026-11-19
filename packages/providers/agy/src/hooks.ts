import type { HookDialect, HookOutput } from "@rivus/agent-kit-harness/spi";
import { AGY_HOOK_TIMEOUT_SECONDS, AGY_HOST_MARKER_FIELD, AGY_ID } from "./facts.js";

// Antigravity CLI lifecycle hooks (`hooks.json`, bundled `agy-customizations/docs/hooks.md`):
// - Top-level keys in `hooks.json` are named hooks, each holding event arrays (`PreToolUse`/`PostToolUse` grouped
//   with `{ matcher, hooks }`; `SessionStart`/`PreInvocation`/`PostInvocation`/`Stop` flat handler lists).
// - Payloads arrive on stdin as camelCase protojson (`hookEventName`, `conversationId`, `cwd`, `workspacePaths`,
//   `transcriptPath`, `artifactDirectoryPath`, `modelName`, `toolCall.{id,name,args}`, `terminationReason`).
// - Hook handlers return JSON on stdout; default timeout is 30 seconds.

const OUTPUT: HookOutput = {
  emptyStdout: "proceed",
  invalidStdout: "undocumented",
  exitCode2: "undocumented",
  otherExitCodes: "proceed",
  passThrough: "{}",
  unverified: "The hooks guide specifies JSON stdout contracts; non-zero exit-code behavior is not documented."
};

const GATE_OUTPUT: HookOutput = {
  emptyStdout: "undocumented",
  invalidStdout: "undocumented",
  exitCode2: "undocumented",
  otherExitCodes: "proceed",
  fields: ["decision", "reason", "permissionOverrides", "overwrite"],
  passThrough: '{"decision":"ask"}',
  unverified:
    "PreToolUse lists `decision` as required (`allow|deny|ask|force_ask`); `ask` defers to the user/cache without auto-approving."
};

export const agyHookDialect: HookDialect = {
  specificationVersion: "harness-v1",
  hostMarkers: { payloadFields: [AGY_HOST_MARKER_FIELD] },
  agent: AGY_ID,
  delivery: "command",
  timeout: { unit: "seconds", default: AGY_HOOK_TIMEOUT_SECONDS },
  output: OUTPUT,
  fields: {
    event: { paths: [["hookEventName"]] },
    sessionId: { paths: [["conversationId"]] },
    cwd: { paths: [["cwd"], ["workspacePaths", "0"]] },
    transcriptPath: { paths: [["transcriptPath"]] },
    toolName: { paths: [["toolCall", "name"]] },
    toolCallId: { paths: [["toolCall", "id"]] }
  },
  events: {
    SessionStart: {
      lifecycle: { phase: "start", scope: "session" },
      output: { ...OUTPUT, fields: ["injectSteps"] }
    },
    PreInvocation: {
      lifecycle: { phase: "start", scope: "turn" },
      output: { ...OUTPUT, fields: ["injectSteps", "terminationBehavior"] }
    },
    PreToolUse: {
      lifecycle: { phase: "activity" },
      gate: true,
      output: GATE_OUTPUT
    },
    PostToolUse: {
      lifecycle: { phase: "activity" }
    },
    PostInvocation: {
      lifecycle: { phase: "activity" },
      output: { ...OUTPUT, fields: ["injectSteps", "terminationBehavior"] }
    },
    Stop: {
      lifecycle: {
        field: ["terminationReason"],
        cases: {
          NO_TOOL_CALL: { phase: "finish", scope: "turn", outcome: "completed" },
          TERMINAL_STEP_TYPE: { phase: "finish", scope: "turn", outcome: "completed" },
          MAX_INVOCATIONS: { phase: "finish", scope: "turn", outcome: "completed" },
          ERROR: { phase: "finish", scope: "turn", outcome: "failed" },
          USER_CANCELED: { phase: "finish", scope: "turn", outcome: "cancelled" }
        },
        otherwise: { phase: "finish", scope: "turn" }
      },
      output: { ...OUTPUT, fields: ["injectSteps", "terminationBehavior"] }
    }
  }
};
