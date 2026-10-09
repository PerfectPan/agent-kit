import type { SessionPreview } from "../../index.js";
import { timeOf } from "../../../transcript/index.js";
import { parseClaudeCodePreviewRecord } from "../../../transcript/adapters/claude-code/record.js";
import { isPromptFlags, recordText, userFlags } from "../../../transcript/adapters/claude-code/user-flags.js";

/** The first prompt follows the turn rule: the first real user prompt on the main lane. */
export function previewClaudeCodeRecords(records: readonly Record<string, unknown>[]): SessionPreview {
  const preview: SessionPreview = {};
  for (const value of records) {
    const record = parseClaudeCodePreviewRecord(value);
    if (!record) {
      continue;
    }
    const ts = timeOf(record.timestamp);
    if (ts !== undefined) {
      preview.startedAt ??= ts;
      preview.lastAt = ts;
    }
    preview.sessionId ??= record.sessionId;
    preview.cwd ??= record.cwd;
    preview.title ??= record.customTitle ?? record.aiTitle;
    if (!preview.firstPrompt && record.type === "user" && !record.isSidechain) {
      const text = recordText(record);
      if (text && isPromptFlags(userFlags(record))) {
        preview.firstPrompt = text.slice(0, 500);
      }
    }
  }
  return preview;
}
