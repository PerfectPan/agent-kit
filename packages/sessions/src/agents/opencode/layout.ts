import type { AgentHome } from "@rivus/agent-kit-catalog";

import { joinPath } from "../../domain/session/index.js";

// opencode keeps its data in its home (`$XDG_DATA_HOME/opencode`). Since 1.2 messages are rows of the `message` table
// in the SQLite database `opencode.db`, each message as JSON in the `data` column; the database runs in WAL mode, so
// recent writes may sit in `opencode.db-wal`. Older versions wrote one JSON file per message under
// `storage/message/<session id>/`, and opencode reads those only when it has no database.

export function opencodeDatabasePath(home: AgentHome): string {
  return joinPath(home.path, "opencode.db");
}

export function opencodeLegacyMessageRoot(home: AgentHome): string {
  return joinPath(joinPath(home.path, "storage"), "message");
}

/**
 * The `message` rows after a row id, a page at a time, for the first read of a database: the row id is indexed, so the
 * read is one pass. It finds the rows in the order they were inserted.
 */
export const OPENCODE_MESSAGES_BY_ROW: string =
  "SELECT rowid AS row, id, session_id, time_created, time_updated, data FROM message " +
  "WHERE rowid > ? AND time_created >= ? ORDER BY rowid LIMIT ?";

/**
 * The `message` rows changed after a position, by the time they were last updated and then by id, a page at a time.
 * Row ids are no position: opencode deletes the messages after a reverted one, and SQLite gives the next inserted row a
 * deleted row's id. A message changes again when it finishes, so an update moves it after the position. No index
 * covers the order, so each page sorts the rows changed since; a decode that continues finds few of them.
 */
export const OPENCODE_MESSAGE_PAGE: string =
  "SELECT rowid AS row, id, session_id, time_created, time_updated, data FROM message " +
  "WHERE (time_updated > ? OR (time_updated = ? AND id > ?)) AND time_created >= ? " +
  "ORDER BY time_updated, id LIMIT ?";

/** Message rows by id, to look again at messages that were still running when a decode stopped. */
export function opencodeMessagesById(count: number): string {
  return `SELECT rowid AS row, id, session_id, time_created, time_updated, data FROM message WHERE id IN (${Array.from(
    { length: count },
    () => "?"
  ).join(", ")})`;
}
