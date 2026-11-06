import { timeOfValue, type SessionPreview } from "@rivus/agent-kit-sessions/spi";
import { geminiCliChatItem } from "./records.js";

/**
 * The head a chat file's both ends show: the activity window from the records' timestamps and the first `user`
 * message's content as the preview's first prompt.
 */
export function previewGeminiCliRecords(records: readonly Record<string, unknown>[]): SessionPreview {
  const preview: SessionPreview = {};
  for (const value of records) {
    const ts = timeOfValue(value);
    if (ts !== undefined) {
      preview.startedAt ??= ts;
      preview.lastAt = ts;
    }
    const item = geminiCliChatItem(value);
    if (preview.firstPrompt === undefined && item.kind === "user" && item.text) {
      preview.firstPrompt = item.text.slice(0, 500);
    }
  }
  return preview;
}
