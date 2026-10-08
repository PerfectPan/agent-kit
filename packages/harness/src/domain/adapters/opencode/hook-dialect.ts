import type { HookDialect } from "../../lifecycle/index.js";

// https://opencode.ai/docs/plugins (plugin directories, hooks, event names). Payload shapes and which events the
// runtime publishes are checked against github.com/anomalyco/opencode at ecc4916: packages/opencode/src/plugin and
// the v2 SDK types (permission.asked, question.*).
//
// opencode calls an in-process plugin, so a bridge plugin forwards the payload. It forwards each bus event as is
// (`{ type, properties }`) with the plugin input's `directory` added at the top level, and the inputs of the
// tool.execute.before / tool.execute.after hooks as `{ type: "<hook name>", properties: input }`.

export const opencodeHookDialect: HookDialect = {
  specificationVersion: "harness-v1",
  agent: "opencode",
  delivery: "plugin",
  fields: {
    event: { paths: [["type"]] },
    sessionId: {
      // session.* events with a Session carry it as info.id; message events carry the message's sessionID.
      paths: [
        ["properties", "sessionID"],
        ["properties", "info", "sessionID"],
        ["properties", "part", "sessionID"],
        ["properties", "info", "id"]
      ]
    },
    cwd: { paths: [["directory"], ["properties", "info", "directory"]] },
    toolName: { paths: [["properties", "tool"]] },
    toolCallId: {
      paths: [
        ["properties", "callID"],
        ["properties", "tool", "callID"]
      ]
    }
  },
  events: {
    "session.created": { lifecycle: { phase: "start", scope: "session" } },
    // No event marks a turn start; the session turning busy is the closest.
    "session.status": {
      lifecycle: {
        field: ["properties", "status", "type"],
        cases: {
          busy: { phase: "start", scope: "turn" },
          retry: { phase: "activity" },
          idle: { phase: "finish", scope: "turn" }
        },
        otherwise: { phase: "unknown" }
      }
    },
    "message.updated": { lifecycle: { phase: "activity" } },
    "message.part.updated": { lifecycle: { phase: "activity" } },
    "tool.execute.before": { lifecycle: { phase: "activity" } },
    "tool.execute.after": { lifecycle: { phase: "activity" } },
    "command.executed": { lifecycle: { phase: "activity" } },
    "file.edited": { lifecycle: { phase: "activity" } },
    "todo.updated": { lifecycle: { phase: "activity" } },
    "session.diff": { lifecycle: { phase: "activity" } },
    "session.updated": { lifecycle: { phase: "activity" } },
    "session.compacted": { lifecycle: { phase: "activity" } },
    // permission.updated is the older SDK's name for the same signal.
    "permission.asked": { lifecycle: { phase: "blocked", blocker: "permission" }, aliases: ["permission.updated"] },
    "permission.replied": { lifecycle: { phase: "activity" } },
    "question.asked": {
      lifecycle: { phase: "blocked", blocker: "question" },
      unverified: "Published by the runtime and typed in the v2 SDK; not in the plugin docs."
    },
    "question.replied": { lifecycle: { phase: "activity" }, unverified: "Not in the plugin docs." },
    "question.rejected": { lifecycle: { phase: "activity" }, unverified: "Not in the plugin docs." },
    // Every change to idle publishes session.status (idle) and then session.idle.
    "session.idle": { lifecycle: { phase: "finish", scope: "turn" } },
    "session.error": {
      lifecycle: {
        field: ["properties", "error", "name"],
        cases: { MessageAbortedError: { phase: "finish", scope: "turn", outcome: "cancelled" } },
        otherwise: { phase: "finish", scope: "turn", outcome: "failed" }
      },
      unverified: "The error names come from the SDK types; the docs list only the event."
    },
    "session.deleted": { lifecycle: { phase: "finish", scope: "session" } }
  }
};
