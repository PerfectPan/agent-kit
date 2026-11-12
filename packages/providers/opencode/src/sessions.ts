import { type SessionAdapter, createSqliteSessionAdapter } from "@rivus/agent-kit-sessions/spi";

import { OPENCODE_ID } from "./facts.js";
import { opencodeDatabaseFile } from "./layout.js";
import { opencodeMessageOf } from "./sessions/records.js";

/**
 * OpenCode keeps sessions in `opencode.db`: one `session` row, `message` rows in creation order, and `part` rows for
 * each message's text, reasoning, tool calls and step boundaries. A session id selects the rows; the database path is
 * the ref's path for every session in it.
 */
export const opencodeSessionAdapter: SessionAdapter = createSqliteSessionAdapter({
  agent: OPENCODE_ID,
  databaseFile: opencodeDatabaseFile,
  sessionNoun: "an OpenCode session",
  softDeletes: false,
  messageSequence: false,
  message: opencodeMessageOf
});
