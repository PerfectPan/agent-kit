import type { HookDialect, HookOutput } from "@rivus/agent-kit-harness/spi";
import { ZCODE_HOST_FIELD, ZCODE_ID, ZCODE_SESSION_ENV } from "./facts.js";

// Read from ZCode 3.17.2's engine (Contents/Resources/glm/zcode.cjs); ZCode documents no hook reference. Command hooks
// come from `hooks.events.<Event>[]` in the user config `~/.zcode/cli/config.json` and in the workspace's `zcode.json`
// and `.zcode/config.json` files from the git root down, and from an enabled plugin's `hooks/hooks.json` in Claude
// Code's plugin format. Hooks run only when some config sets `hooks.enabled: true`; the shipped default is off. Each run
// gets the payload as JSON on stdin: Claude Code's snake_case fields next to the camelCase hook input ZCode passes
// through, and the environment carries `ZCODE_SESSION_ID` and `ZCODE_PROJECT_DIR` beside their `CLAUDE_*` equivalents.

/** Every event reads the same top-level JSON fields. */
const FIELDS: readonly string[] = [
  "additionalContext",
  "additional_context",
  "continue",
  "decision",
  "hookSpecificOutput",
  "reason",
  "stopReason",
  "suppressOutput",
  "systemMessage"
];

/**
 * Exit 0 reads stdout as JSON when it starts with `{` and ignores other text; JSON that does not match the output
 * schema, or whose `hookSpecificOutput` names another event, fails the hook instead. Exit 2 blocks; any other exit
 * fails the hook, which a PreToolUse declaration's `onError: "deny"` turns into a denial. `{}` decides nothing.
 */
const OUTPUT: HookOutput = {
  emptyStdout: "proceed",
  invalidStdout: "proceed",
  exitCode2: "block",
  otherExitCodes: "hook-failed",
  passThrough: "{}"
};

export const zcodeHookDialect: HookDialect = {
  specificationVersion: "harness-v1",
  // Every hook input carries ZCode's own `traceId`. Its other camelCase fields (`hookEventName`, `sessionId`) are
  // Grok's names, so the shell checks this dialect before Grok's.
  hostMarkers: { payloadFields: [ZCODE_HOST_FIELD] },
  agent: ZCODE_ID,
  delivery: "command",
  // A declaration's `timeoutMs`; the runtime default is 60 s.
  timeout: { unit: "milliseconds", default: 60_000 },
  // Workspace hooks wait for a review of their declarations' digests; the user config's and plugins' hooks need none.
  trust: { review: "content-hash" },
  output: OUTPUT,
  // `transcript_path` is not mapped: it names a file ZCode writes for one run and deletes afterwards.
  fields: {
    event: { paths: [["hook_event_name"]] },
    sessionId: { paths: [["session_id"]], env: [ZCODE_SESSION_ENV] },
    cwd: { paths: [["cwd"]] },
    turnId: { paths: [["turnId"]] },
    toolName: { paths: [["tool_name"]] },
    toolCallId: { paths: [["tool_use_id"]] }
  },
  events: {
    // `source` is `startup` or `resume`.
    SessionStart: { lifecycle: { phase: "start", scope: "session" } },
    UserPromptSubmit: { lifecycle: { phase: "start", scope: "turn" } },
    PreToolUse: { lifecycle: { phase: "activity" }, gate: true, output: { ...OUTPUT, fields: FIELDS } },
    PermissionRequest: {
      lifecycle: { phase: "blocked", blocker: "permission" },
      gate: true,
      output: { ...OUTPUT, fields: FIELDS }
    },
    PostToolUse: { lifecycle: { phase: "activity" } },
    PostToolUseFailure: { lifecycle: { phase: "activity" } },
    Stop: { lifecycle: { phase: "finish", scope: "turn", outcome: "completed" } }
  }
};
