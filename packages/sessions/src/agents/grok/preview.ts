import type { SessionPreview } from "../../domain/session/index.js";
import { timeOf } from "../../domain/transcript/index.js";
import { asRecord } from "../record-fields.js";
import { chunkText, GROK_META_KEY, isInjectedChunk, updateOf } from "./chunks.js";

/** The first prompt follows the turn rule: the first user chunk that is not injected. */
export function previewGrokRecords(records: readonly Record<string, unknown>[]): SessionPreview {
  const preview: SessionPreview = {};
  for (const record of records) {
    const update = updateOf(record);
    const ts = timeOf(record.timestamp);
    if (ts !== undefined) {
      preview.startedAt ??= ts;
      preview.lastAt = ts;
    }
    if (preview.firstPrompt || update?.sessionUpdate !== "user_message_chunk") {
      continue;
    }
    const text = chunkText(update.content);
    if (text && !isInjectedChunk(asRecord(update[GROK_META_KEY]), text)) {
      preview.firstPrompt = text.slice(0, 500);
    }
  }
  return preview;
}
