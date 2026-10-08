import type { HookDialect } from "../../lifecycle/index.js";

// https://github.com/earendil-works/pi/blob/27c7b6f/packages/coding-agent/docs/extensions.md and the event types
// in packages/coding-agent/src/core/extensions/types.ts (npm @earendil-works/pi-coding-agent; the older
// @mariozechner/pi-coding-agent lacks agent_settled and ui_prompt_*).
//
// Pi calls an in-process extension, so a bridge extension forwards the payload: the event object with its name as
// `type`, plus `sessionId` from `ctx.sessionManager.getSessionId()` and `cwd` from `ctx.cwd`, which the events
// themselves do not carry.

export const piHookDialect: HookDialect = {
  specificationVersion: "harness-v1",
  agent: "pi",
  delivery: "plugin",
  fields: {
    event: { paths: [["type"]] },
    sessionId: { paths: [["sessionId"]] },
    cwd: { paths: [["cwd"]] },
    toolName: { paths: [["toolName"]] },
    toolCallId: { paths: [["toolCallId"]] }
  },
  events: {
    session_start: { lifecycle: { phase: "start", scope: "session" } },
    before_agent_start: { lifecycle: { phase: "start", scope: "turn" } },
    agent_start: { lifecycle: { phase: "start", scope: "turn" } },
    // A Pi turn is one model request and its tool round inside an agent run.
    turn_start: { lifecycle: { phase: "activity" } },
    turn_end: { lifecycle: { phase: "activity" } },
    tool_call: { lifecycle: { phase: "activity" } },
    tool_execution_start: { lifecycle: { phase: "activity" } },
    tool_execution_end: { lifecycle: { phase: "activity" } },
    session_compact: { lifecycle: { phase: "activity" } },
    // Pi has no permission event; a blocking extension UI prompt is the closest.
    ui_prompt_start: { lifecycle: { phase: "blocked", blocker: "question" } },
    ui_prompt_end: { lifecycle: { phase: "activity" } },
    // Retries, compaction or queued work can still follow agent_end; agent_settled is the final idle signal.
    agent_end: { lifecycle: { phase: "finish", scope: "turn" } },
    agent_settled: { lifecycle: { phase: "finish", scope: "turn" } },
    session_shutdown: { lifecycle: { phase: "finish", scope: "session" } }
  }
};
