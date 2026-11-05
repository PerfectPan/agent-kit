import { timeOf, type SessionPreview } from "@rivus/agent-kit-sessions/spi";
import { geminiCliChatRecord } from "./records.js";

/**
 * The head a chat file's both ends show: the activity window from the records' timestamps and the first `user`
 * message's content as the preview's first prompt.
 */
export function previewGeminiCliRecords(records: readonly Record<string, unknown>[]): SessionPreview {
  const preview: SessionPreview = {};
  for (const value of records) {
    const record = geminiCliChatRecord(value);
    if (record === undefined) {
      continue;
    }
    const ts = timeOf(record.timestamp);
    if (ts !== undefined) {
      preview.startedAt ??= ts;
      preview.lastAt = ts;
    }
    if (
      preview.firstPrompt === undefined &&
      record.type === "user" &&
      record.content !== undefined &&
      record.content.length > 0
    ) {
      preview.firstPrompt = record.content.slice(0, 500);
    }
  }
  return preview;
}
