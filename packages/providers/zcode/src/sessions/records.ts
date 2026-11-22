import { type SqliteSessionMessage, lenient, sqliteSessionMessageOf } from "@rivus/agent-kit-sessions/spi";
import * as z from "zod/mini";

import { zcodeUsage } from "../usage.js";

const ZcodeForkMetadata = z.looseObject({
  metadata: lenient(z.looseObject({ forkOrigin: z.unknown() }))
});

/** A `runtime/prompt_snapshot` entry: the model selection and the system blocks the conversation opened with. */
const ZcodePromptSnapshot = z.looseObject({
  system: lenient(z.array(z.looseObject({ role: lenient(z.string()), content: lenient(z.string()) })))
});

/**
 * A prompt snapshot entry's reading: the `system` blocks joined the way multi-part prompts join, empty when the
 * entry records no text, `undefined` when the row is not a readable snapshot. ZCode records no tool schemas.
 */
export function zcodePromptSnapshotOf(value: unknown): { systemPrompt?: string } | undefined {
  const snapshot = z.safeParse(ZcodePromptSnapshot, value).data;
  if (snapshot === undefined) {
    return undefined;
  }
  const systemPrompt = (snapshot.system ?? [])
    .map((block) => block.content)
    .filter((content) => content !== "")
    .join("\n\n");
  return systemPrompt === "" ? {} : { systemPrompt };
}

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
