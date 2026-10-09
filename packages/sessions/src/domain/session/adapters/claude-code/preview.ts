import type { SessionPreview } from "../../index.js";
import { timeOf } from "../../../transcript/index.js";
import { asRecord, asString } from "../../../transcript/adapters/record-fields.js";
import { isPromptFlags, recordText, userFlags } from "../../../transcript/adapters/claude-code/user-flags.js";

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
