import type { HookDialectSample } from "../../../src/hook-dialect-conformance.js";
import { zcodePayload } from "../../../../providers/zcode/test/fixtures/hooks.js";

const payload = zcodePayload({
  cwd: "/u/me/work",
  hookEventName: "PreToolUse",
  mode: "build",
  riskLevel: "medium",
  sessionId: "ses_zc02",
  sideEffectScope: "workspace",
  timestamp: "2026-11-01T10:00:00.000Z",
  toolCallId: "call_2",
  toolInput: { command: "npm test" },
  toolName: "Bash",
  traceId: "trace-zc02",
  turnId: "turn-zc02"
});

// ZCode runs Claude Code plugins, exports CLAUDE_* beside ZCODE_*, and sends Grok's camelCase field names; its own
// traceId still names it.
export const zcodeHostSamples: readonly HookDialectSample[] = [
  {
    name: "a hook registered for Claude Code and run by ZCode names ZCode",
    declaredAgent: "claude-code",
    payload,
    env: { CLAUDE_PROJECT_DIR: "/u/me/work", CLAUDE_CODE_SESSION_ID: "ses_zc02", ZCODE_SESSION_ID: "ses_zc02" },
    expected: {
      agent: "zcode",
      sessionId: "ses_zc02",
      cwd: "/u/me/work",
      turnId: "turn-zc02",
      nativeEvent: "PreToolUse",
      phase: "activity",
      tool: { name: "Bash", callId: "call_2" }
    }
  }
];
