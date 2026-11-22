import { type SqliteSessionMessage, sqliteSessionMessageOf } from "@rivus/agent-kit-sessions/spi";

import { zcodeUsage } from "../usage.js";

/** Stored message times include completion; ZCode's tokens already count the kit's way. */
export function zcodeMessageOf(value: unknown): SqliteSessionMessage | undefined {
  return sqliteSessionMessageOf(value, zcodeUsage);
}
