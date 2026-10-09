import type { SessionHead, SessionPreview } from "../../index.js";
import { SESSION_TITLE_MAX } from "../../index.js";
import { timeOf } from "../../../transcript/index.js";
import { acpChunkText, acpUpdateOf } from "../../../transcript/adapters/acp-updates.js";
import type { GrokSessionMeta } from "./layout.js";
import { isInjectedChunk } from "../../../transcript/adapters/grok/chunks.js";

/** The first prompt follows the turn rule: the first user chunk that is not injected. */
export function previewGrokRecords(records: readonly Record<string, unknown>[]): SessionPreview {
  const preview: SessionPreview = {};
  for (const record of records) {
    const update = acpUpdateOf(record);
    const ts = timeOf(record.timestamp);
    if (ts !== undefined) {
      preview.startedAt ??= ts;
      preview.lastAt = ts;
    }
    if (preview.firstPrompt || update?.sessionUpdate !== "user_message_chunk") {
      continue;
    }
    const text = acpChunkText(update.content);
    if (text && !isInjectedChunk(update._meta, text)) {
      preview.firstPrompt = text.slice(0, 500);
    }
  }
  return preview;
}

/**
 * Applies what a parsed `summary.json` says over the previewed head: its session id, its title cut to
 * `SESSION_TITLE_MAX` characters like the preview's, its cwd, and its end time as the last activity.
 */
export function applyGrokSummary(head: SessionHead, fields: GrokSessionMeta): void {
  if (fields.id) {
    head.ref = { agent: head.ref.agent, path: head.ref.path, sessionId: fields.id };
  }
  if (fields.title) {
    head.title = fields.title.slice(0, SESSION_TITLE_MAX);
  }
  if (fields.cwd) {
    head.cwd = fields.cwd;
  }
  if (fields.endedAt !== undefined) {
    head.lastActiveAt = fields.endedAt;
  }
}
