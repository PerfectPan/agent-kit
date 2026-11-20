import type { HookDialectSample } from "@rivus/agent-kit-testing/public";

// Synthetic Antigravity CLI hook payloads (`agy-customizations/docs/hooks.md`), passed on stdin as camelCase JSON.

const sessionId = "ec33ebf9-0cba-4100-8142-c61503f6c587";
const cwd = "/u/me/work";
const transcriptPath = `${cwd}/.gemini/antigravity-cli/brain/${sessionId}/.system_generated/logs/transcript.jsonl`;
const base = {
  conversationId: sessionId,
  workspacePaths: [cwd],
  transcriptPath,
  artifactDirectoryPath: `${cwd}/.gemini/antigravity-cli/brain/${sessionId}`,
  modelName: "gemini-4-neon-medium",
  cwd
};

const sample = (
  event: string,
  extra: Record<string, unknown>,
  expected: Omit<HookDialectSample["expected"], "agent" | "sessionId" | "cwd" | "nativeEvent" | "transcriptPath">
): HookDialectSample => {
  const reason = extra["terminationReason"];
  return {
    name: typeof reason === "string" ? `${event} (${reason})` : event,
    payload: { ...base, hookEventName: event, ...extra },
    expected: { agent: "agy", sessionId, cwd, transcriptPath, nativeEvent: event, ...expected }
  };
};

export const agySamples: readonly HookDialectSample[] = [
  sample("SessionStart", {}, { phase: "start", scope: "session" }),
  sample("PreInvocation", { invocationNum: 1, initialNumSteps: 2 }, { phase: "start", scope: "turn" }),
  sample(
    "PreToolUse",
    { toolCall: { id: "toolu_01", name: "run_command", args: { CommandLine: "pnpm test" } }, stepIdx: 3 },
    { phase: "activity", tool: { name: "run_command", callId: "toolu_01" } }
  ),
  sample(
    "PostToolUse",
    { toolCall: { id: "toolu_01", name: "run_command", args: { CommandLine: "pnpm test" } }, stepIdx: 4 },
    { phase: "activity", tool: { name: "run_command", callId: "toolu_01" } }
  ),
  sample("PostInvocation", { invocationNum: 1, initialNumSteps: 2 }, { phase: "activity" }),
  sample(
    "Stop",
    { executionNum: 1, terminationReason: "NO_TOOL_CALL", fullyIdle: true },
    { phase: "finish", scope: "turn", outcome: "completed" }
  ),
  sample(
    "Stop",
    { executionNum: 1, terminationReason: "ERROR", error: "model error", fullyIdle: true },
    { phase: "finish", scope: "turn", outcome: "failed" }
  ),
  sample(
    "Stop",
    { executionNum: 1, terminationReason: "USER_CANCELED", fullyIdle: true },
    { phase: "finish", scope: "turn", outcome: "cancelled" }
  )
];
