import type { AgentHome } from "@rivus/agent-kit-catalog/spi";

import { joinPath } from "@rivus/agent-kit-sessions/spi";
import { OPENCODE_DATABASE, OPENCODE_MESSAGE_DIR } from "./facts.js";

export const opencodeDatabaseFile: string = OPENCODE_DATABASE;
export const opencodeMessageDirectory: string = OPENCODE_MESSAGE_DIR;

// opencode keeps its data in its home (`$XDG_DATA_HOME/opencode`). Since 1.2 messages are rows of the `message` table
// in the SQLite database `opencode.db`, each message as JSON in the `data` column; the database runs in WAL mode, so
// recent writes may sit in `opencode.db-wal`. Older versions wrote one JSON file per message under
// `storage/message/<session id>/`, and opencode reads those only when it has no database.

export function opencodeDatabasePath(home: AgentHome): string {
  return joinPath(home.path, opencodeDatabaseFile);
}

export function opencodeLegacyMessageRoot(home: AgentHome): string {
  return joinPath(home.path, opencodeMessageDirectory);
}
