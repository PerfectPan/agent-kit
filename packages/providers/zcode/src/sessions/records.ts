import { type SqliteSessionMessage, sqliteSessionMessageOf } from "@rivus/agent-kit-sessions/spi";

import { zcodeUsage } from "../usage.js";

/** A stored message's JSON as the shared SQLite session reader reads it; ZCode's tokens already count the kit's way. */
export function zcodeMessageOf(value: unknown): SqliteSessionMessage | undefined {
  return sqliteSessionMessageOf(value, zcodeUsage);
}
