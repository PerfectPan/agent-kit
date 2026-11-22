import { type SqliteSessionMessage, lenient, sqliteSessionMessageOf } from "@rivus/agent-kit-sessions/spi";
import * as z from "zod/mini";

import { zcodeUsage } from "../usage.js";

const ZcodeForkMetadata = z.looseObject({
  metadata: lenient(z.looseObject({ forkOrigin: z.unknown() }))
});

/**
 * Stored message times include completion; ZCode's tokens already count the kit's way. Messages copied from a parent
 * session into a branch (such as `selection_side_chat` or `workflow_child`) carry `metadata.forkOrigin` and are marked
 * `inherited` so attaching the child lane does not duplicate parent history.
 */
export function zcodeMessageOf(value: unknown): SqliteSessionMessage | undefined {
  const message = sqliteSessionMessageOf(value, zcodeUsage);
  if (message === undefined) {
    return undefined;
  }
  const forkOrigin = z.safeParse(ZcodeForkMetadata, value).data?.metadata?.forkOrigin;
  return forkOrigin !== undefined && forkOrigin !== null ? { ...message, inherited: true } : message;
}
