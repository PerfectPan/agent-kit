import type { LifecycleEvent } from "@rivus/agent-kit-harness";

import type { HookDialectSample } from "../../../src/hook-dialect-conformance.js";

// Scrubbed opencode plugin events (https://opencode.ai/docs/plugins), as a bridge plugin forwards them: the bus
// event with the plugin's `directory`, and tool hook inputs as `{ type, properties: input }`. A running bridge also
// adds `currentSessionId` when it has seen a session and this payload names none. These samples are single payloads,
// so `file.edited` here carries no session id.

const sessionID = "ses_4f2a-opencode";
const directory = "/u/me/work";
const identity = { agent: "opencode", sessionId: sessionID, cwd: directory } as const;

function sample(
  name: string,
  type: string,
  properties: Record<string, unknown>,
  expected: Omit<LifecycleEvent, "agent" | "nativeEvent">
): HookDialectSample {
  return {
    name,
    payload: { type, properties, directory },
    expected: { ...identity, nativeEvent: type, ...expected }
  };
}

const session = { id: sessionID, directory, title: "work", version: "1.2.0" };

export const opencodeSamples: readonly HookDialectSample[] = [
  sample("session.created", "session.created", { info: session }, { phase: "start", scope: "session" }),
  sample(
    "session.status busy",
    "session.status",
    { sessionID, status: { type: "busy" } },
    {
      phase: "start",
      scope: "turn"
    }
  ),
  sample(
    "session.status retry",
    "session.status",
    { sessionID, status: { type: "retry", attempt: 1 } },
    {
      phase: "activity"
    }
  ),
  sample(
    "session.status idle",
    "session.status",
    { sessionID, status: { type: "idle" } },
    {
      phase: "finish",
      scope: "turn"
    }
  ),
  sample(
    "message.updated",
    "message.updated",
    { info: { id: "msg_1", sessionID, role: "assistant" } },
    {
      phase: "activity"
    }
  ),
  sample(
    "message.part.updated",
    "message.part.updated",
    { part: { id: "prt_1", sessionID, type: "text" } },
    {
      phase: "activity"
    }
  ),
  sample(
    "tool.execute.before",
    "tool.execute.before",
    { tool: "bash", sessionID, callID: "call_9" },
    {
      phase: "activity",
      tool: { name: "bash", callId: "call_9" }
    }
  ),
  sample(
    "tool.execute.after",
    "tool.execute.after",
    { tool: "bash", sessionID, callID: "call_9" },
    {
      phase: "activity",
      tool: { name: "bash", callId: "call_9" }
    }
  ),
  sample("command.executed", "command.executed", { name: "review", sessionID, arguments: "" }, { phase: "activity" }),
  {
    name: "file.edited names no session",
    payload: { type: "file.edited", properties: { file: "/u/me/work/a.ts" }, directory },
    expected: { agent: "opencode", nativeEvent: "file.edited", phase: "activity", cwd: directory }
  },
  sample("todo.updated", "todo.updated", { sessionID, todos: [] }, { phase: "activity" }),
  sample("session.diff", "session.diff", { sessionID, diff: [] }, { phase: "activity" }),
  sample("session.updated", "session.updated", { info: session }, { phase: "activity" }),
  sample("session.compacted", "session.compacted", { sessionID }, { phase: "activity" }),
  sample(
    "permission.asked",
    "permission.asked",
    { id: "per_1", sessionID, permission: "bash", patterns: ["npm *"], tool: { messageID: "msg_1", callID: "call_9" } },
    { phase: "blocked", blocker: "permission" }
  ),
  sample(
    "permission.updated from the older SDK",
    "permission.updated",
    { id: "per_1", sessionID, type: "bash" },
    {
      phase: "blocked",
      blocker: "permission"
    }
  ),
  sample(
    "permission.replied",
    "permission.replied",
    { sessionID, requestID: "per_1", reply: "once" },
    {
      phase: "activity"
    }
  ),
  sample("question.asked", "question.asked", { id: "que_1", sessionID }, { phase: "blocked", blocker: "question" }),
  sample("question.replied", "question.replied", { sessionID, requestID: "que_1" }, { phase: "activity" }),
  sample("question.rejected", "question.rejected", { sessionID, requestID: "que_1" }, { phase: "activity" }),
  sample("session.idle", "session.idle", { sessionID }, { phase: "finish", scope: "turn" }),
  sample(
    "session.error aborted",
    "session.error",
    { sessionID, error: { name: "MessageAbortedError", data: {} } },
    {
      phase: "finish",
      scope: "turn",
      outcome: "cancelled"
    }
  ),
  sample(
    "session.error",
    "session.error",
    { sessionID, error: { name: "APIError", data: {} } },
    {
      phase: "finish",
      scope: "turn",
      outcome: "failed"
    }
  ),
  sample("session.deleted", "session.deleted", { info: session }, { phase: "finish", scope: "session" })
];
