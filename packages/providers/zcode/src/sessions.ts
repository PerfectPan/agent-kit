import { type SessionAdapter, createSqliteSessionAdapter } from "@rivus/agent-kit-sessions/spi";

import { ZCODE_ID } from "./facts.js";
import { zcodeDatabaseBelowHome } from "./layout.js";
import { zcodeMessageOf } from "./sessions/records.js";

/**
 * ZCode keeps every session in `<home>/cli/db/db.sqlite`, in OpenCode's table layout: one `session` row, `message`
 * rows in the app's `sequence` order with the message as JSON in the `data` column, and `part` rows for each
 * message's text, reasoning, tool calls and step boundaries. A session id selects the rows; the database path is the
 * ref's path for every session in it. A soft-deleted session (`time_deleted` set) is gone for the app and stays gone
 * here.
 */
export const zcodeSessionAdapter: SessionAdapter = createSqliteSessionAdapter({
  agent: ZCODE_ID,
  databaseFile: zcodeDatabaseBelowHome,
  sessionNoun: "a ZCode session",
  softDeletes: true,
  messageSequence: true,
  message: zcodeMessageOf
});
