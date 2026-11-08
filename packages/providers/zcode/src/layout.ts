import type { AgentHome } from "@rivus/agent-kit-catalog/spi";
import { joinPath } from "@rivus/agent-kit-sessions/spi";
import { ZCODE_DATABASE, ZCODE_DB_DIR } from "./facts.js";

export const zcodeDatabaseDirectory: string = ZCODE_DB_DIR;
export const zcodeDatabaseFile: string = ZCODE_DATABASE;

/** The database below the home, as a probe path names it. */
export const zcodeDatabaseBelowHome: string = `${zcodeDatabaseDirectory}/${zcodeDatabaseFile}`;

// ZCode keeps its data in its home (`$ZCODE_STORAGE_DIR`, default `~/.zcode`). The desktop app's built-in CLI writes
// one SQLite database per install at `cli/db/db.sqlite`: a `message` table holds every message of every session, the
// message itself as JSON in the `data` column (fields `modelId`/`providerId`, `tokens`, `time`), with the message and
// session ids only in the row's `id` and `session_id` columns. The database runs in WAL mode, so recent writes may sit
// in `db.sqlite-wal`.

export function zcodeDatabasePath(home: AgentHome): string {
  return joinPath(home.path, zcodeDatabaseBelowHome);
}
