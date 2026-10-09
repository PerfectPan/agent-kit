import * as z from "zod/mini";

import type { SessionPreview } from "../../index.js";
import { timeOf } from "../../../transcript/index.js";
import { lenient } from "../../../transcript/adapters/lenient.js";
import { logTimestamp } from "../../../transcript/adapters/timestamp.js";
import { INJECTED_USER, textFrom } from "../../../transcript/adapters/codex/response-items.js";

/**
 * The fields the preview reads, of the envelope or of the payload behind `response_item`. Listing runs it over both
 * ends of every session file, so it parses only these fields, not the whole record.
 */
const PreviewRecord = z.looseObject({
  type: lenient(z.string()),
  role: lenient(z.string()),
  content: z.optional(z.unknown()),
  timestamp: logTimestamp,
  payload: lenient(
    z.looseObject({
      id: lenient(z.string()),
      session_id: lenient(z.string()),
      cwd: lenient(z.string()),
      type: lenient(z.string()),
      role: lenient(z.string()),
      content: z.optional(z.unknown()),
      timestamp: logTimestamp
    })
  )
});

/** The first prompt follows the turn rule: the first user message that is not text Codex injected. */
export function previewCodexRecords(records: readonly Record<string, unknown>[]): SessionPreview {
  const preview: SessionPreview = {};
  for (const value of records) {
    const rec = z.safeParse(PreviewRecord, value).data;
    const payload = rec?.payload;
    const ts = timeOf(rec?.timestamp) ?? timeOf(payload?.timestamp);
    if (ts !== undefined) {
      preview.startedAt ??= ts;
      preview.lastAt = ts;
    }
    if (rec?.type === "session_meta") {
      preview.sessionId ??= payload?.id ?? payload?.session_id;
      preview.cwd ??= payload?.cwd;
    }
    const item = rec?.type === "response_item" ? payload : rec;
    if (!preview.firstPrompt && item?.type === "message" && item.role === "user") {
      const text = textFrom(item.content);
      if (text && !INJECTED_USER.test(text)) {
        preview.firstPrompt = text.slice(0, 500);
      }
    }
  }
  return preview;
}
