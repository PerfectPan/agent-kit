import type { SessionPreview } from "../../domain/session/index.js";
import { timeOf } from "../../domain/transcript/index.js";
import { asRecord, asString } from "../../protocols/record-fields.js";
import { isPromptFlags, recordText, userFlags } from "./user-flags.js";

/** The first prompt follows the turn rule: the first real user prompt on the main lane. */
export function previewClaudeCodeRecords(records: readonly Record<string, unknown>[]): SessionPreview {
  const preview: SessionPreview = {};
  for (const record of records) {
    const ts = timeOf(record.timestamp);
    if (ts !== undefined) {
      preview.startedAt ??= ts;
      preview.lastAt = ts;
    }
    preview.sessionId ??= asString(record.sessionId);
    preview.cwd ??= asString(record.cwd);
    preview.title ??= asString(record.customTitle) ?? asString(record.aiTitle);
    if (!preview.firstPrompt && record.type === "user" && record.isSidechain !== true) {
      const content = asRecord(record.message)?.content;
      const text = recordText(content);
      if (text && isPromptFlags(userFlags(record, content))) {
        preview.firstPrompt = text.slice(0, 500);
      }
    }
  }
  return preview;
}
