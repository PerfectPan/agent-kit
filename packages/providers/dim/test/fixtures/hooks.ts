import type { LifecycleEvent } from "@rivus/agent-kit-harness/public/events";

import type { HookDialectSample } from "@rivus/agent-kit-testing/public";

// Synthetic DimCode hook payloads, from the CLI's own parser (0.5.27): the documented base fields on stdin, plus the
// session fields. The per-event tool fields are not documented and stay unmapped until a capture confirms them.

const sessionId = "b1c2d3e4-5f6a-4b7c-8d9e-0f1a2b3c4d5e";
const cwd = "/u/me/work";
const transcriptPath = `${cwd}/.dimcode/v2/tracelog/${sessionId}/run.jsonl`;
const identity = { agent: "dim", sessionId, cwd, transcriptPath } as const;

function sample(
  event: string,
  fields: Record<string, unknown>,
  expected: Omit<LifecycleEvent, "agent" | "nativeEvent">
): HookDialectSample {
  return {
    name: event,
    payload: {
      hook_event_name: event,
      session_id: sessionId,
      transcript_path: transcriptPath,
      cwd,
      model: "glm-4.6",
      permission_mode: "default",
      run_id: "run-1",
      ...fields
    },
    expected: { ...identity, nativeEvent: event, ...expected }
  };
}

export const dimSamples: readonly HookDialectSample[] = [
  sample("SessionStart", { source: "startup" }, { phase: "start", scope: "session" }),
  sample("UserPromptSubmit", { prompt: "list files" }, { phase: "start", scope: "turn" }),
  sample("PreToolUse", {}, { phase: "activity" }),
  sample("PermissionRequest", {}, { phase: "blocked", blocker: "permission" }),
  sample("PostToolUse", {}, { phase: "activity" }),
  sample("PreCompact", { trigger: "auto" }, { phase: "activity" }),
  sample("PostCompact", { trigger: "manual" }, { phase: "activity" }),
  sample("SubagentStart", { agenttype: "explorer" }, { phase: "start", subagent: {} }),
  sample("SubagentStop", { agenttype: "explorer" }, { phase: "finish", subagent: {} }),
  sample("Stop", {}, { phase: "finish", scope: "turn", outcome: "completed" })
];
