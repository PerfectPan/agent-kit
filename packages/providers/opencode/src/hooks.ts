import type { FieldPath, HookDialect, PayloadFields } from "@rivus/agent-kit-harness/spi";
import { OPENCODE_ID, OPENCODE_CURRENT_SESSION_FIELD as opencodeCurrentSessionField } from "./facts.js";

// https://opencode.ai/docs/plugins (plugin directories, hooks, event names). Payload shapes and which events the
// runtime publishes are checked against github.com/anomalyco/opencode at ecc4916: packages/opencode/src/plugin and
// the v2 SDK types (permission.asked, question.*).
//
// opencode calls an in-process plugin, so a bridge plugin forwards the payload. It forwards each bus event as is
// (`{ id, type, properties }`, where `id` is the event id) with the plugin input's `directory` added at the top
// level, and the inputs of the tool.execute.before / tool.execute.after hooks as
// `{ type: "<hook name>", properties: input, directory }`. One call of the plugin function is one directory. On an
// event that names no session, the bridge adds `currentSessionId`: the session id this dialect reads from the latest
// event that plugin instance saw name one, forwarded or not, until that session is deleted. It is not persisted, and
// with several sessions in one directory it is the latest one's. That key is not one opencode sends (`id`, `type`,
// `properties`, `sessionID`) and not `directory`, so adding it never overwrites the event.

/** Message events carry the message's sessionID, part events the part's. */
const NAMED_SESSION: readonly FieldPath[] = [
  ["properties", "sessionID"],
  ["properties", "info", "sessionID"],
  ["properties", "part", "sessionID"]
];

// The bridge's field is last, so an event that names a session keeps its own id.
const REMEMBERED_SESSION: FieldPath = [opencodeCurrentSessionField];

// `info` is a Session only on these events; elsewhere its `id` can be a message's or a terminal's (pty.*).
const SESSION_INFO: Omit<PayloadFields, "event"> = {
  sessionId: { paths: [...NAMED_SESSION, ["properties", "info", "id"], REMEMBERED_SESSION] }
};

export const opencodeHookDialect: HookDialect = {
  specificationVersion: "harness-v1",
  agent: OPENCODE_ID,
  delivery: "plugin",
  fields: {
    event: { paths: [["type"]] },
    sessionId: { paths: [...NAMED_SESSION, REMEMBERED_SESSION] },
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
    "session.created": { lifecycle: { phase: "start", scope: "session" }, fields: SESSION_INFO },
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
    "session.updated": { lifecycle: { phase: "activity" }, fields: SESSION_INFO },
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
    "session.deleted": { lifecycle: { phase: "finish", scope: "session" }, fields: SESSION_INFO }
  }
};
