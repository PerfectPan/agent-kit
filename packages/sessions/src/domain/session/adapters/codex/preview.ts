import type { SessionPreview } from "../../index.js";
import { timeOf } from "../../../transcript/index.js";
import { asRecord, asString } from "../../../transcript/adapters/record-fields.js";
import { INJECTED_USER, textFrom } from "../../../transcript/adapters/codex/response-items.js";

/** The first prompt follows the turn rule: the first user message that is not text Codex injected. */
export function previewCodexRecords(records: readonly Record<string, unknown>[]): SessionPreview {
  const preview: SessionPreview = {};
  for (const record of records) {
    const payload = asRecord(record.payload);
    const ts = timeOf(record.timestamp) ?? timeOf(payload?.timestamp);
    if (ts !== undefined) {
      preview.startedAt ??= ts;
      preview.lastAt = ts;
    }
    if (record.type === "session_meta") {
      preview.sessionId ??= asString(payload?.id) ?? asString(payload?.session_id);
      preview.cwd ??= asString(payload?.cwd);
    }
    const item = record.type === "response_item" ? payload : record;
    if (!preview.firstPrompt && item?.type === "message" && item.role === "user") {
      const text = textFrom(item.content);
      if (text && !INJECTED_USER.test(text)) {
        preview.firstPrompt = text.slice(0, 500);
      }
    }
  }
  return preview;
}
