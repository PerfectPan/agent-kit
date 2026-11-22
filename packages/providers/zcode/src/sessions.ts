import { type SessionAdapter, createSqliteSessionAdapter } from "@rivus/agent-kit-sessions/spi";

import { ZCODE_ID } from "./facts.js";
import { zcodeDatabaseBelowHome } from "./layout.js";
import { zcodeMessageOf, zcodePromptSnapshotOf } from "./sessions/records.js";

/**
 * ZCode keeps every session in `<home>/cli/db/db.sqlite`, in OpenCode's table layout: one `session` row, `message`
 * rows in the app's `sequence` order with the message as JSON in the `data` column, and `part` rows for each
 * message's text, reasoning, tool calls and step boundaries. A session id selects the rows; the database path is the
 * ref's path for every session in it. A soft-deleted session (`time_deleted` set) is gone for the app and stays gone
 * here. The `session_entry` rows of type `runtime/prompt_snapshot` carry the system prompt the conversation opened
 * with; the adapter reads only that entry type, so the other runtime entries stay unread.
 */
export const zcodeSessionAdapter: SessionAdapter = createSqliteSessionAdapter({
  agent: ZCODE_ID,
  databaseFile: zcodeDatabaseBelowHome,
  sessionNoun: "a ZCode session",
  softDeletes: true,
  messageSequence: true,
  isSubagent: ({ taskType }) => taskType !== "fork",
  message: zcodeMessageOf,
  promptSnapshots: {
    table: "session_entry",
    entryType: "runtime/prompt_snapshot",
    parse: zcodePromptSnapshotOf
  }
});
