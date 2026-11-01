import { SESSION_TITLE_MAX, type SessionPreview, timeOfValue } from "@rivus/agent-kit-sessions/spi";

import { piContentParts, piEntryOf, piHeaderOf } from "../records.js";

/** The first prompt a listing keeps, before the head cuts it to the title budget. */
const FIRST_PROMPT_MAX = 500;

/**
 * The preview of one Pi session from the records at both ends of its file: the header's id and cwd, the
 * `session_info` name, the first user text, and the first and last times.
 */
export function previewPiRecords(records: readonly Record<string, unknown>[]): SessionPreview {
  const preview: SessionPreview = {};
  for (const value of records) {
    const header = piHeaderOf(value);
    if (header) {
      if (header.id) {
        preview.sessionId = header.id;
      }
      if (header.cwd) {
        preview.cwd = header.cwd;
      }
    }
    const entry = piEntryOf(value);
    if (entry?.type === "session_info" && entry.name) {
      preview.title = entry.name.slice(0, SESSION_TITLE_MAX);
    }
    const ts = timeOfValue(value);
    if (ts !== undefined) {
      preview.startedAt = preview.startedAt === undefined ? ts : Math.min(preview.startedAt, ts);
      preview.lastAt = preview.lastAt === undefined ? ts : Math.max(preview.lastAt, ts);
    }
    if (preview.firstPrompt === undefined && entry?.type === "message" && entry.message?.role === "user") {
      const text = piContentParts(entry.message.content)
        .filter((part) => part.kind === "text")
        .map((part) => part.text)
        .join("\n")
        .trim();
      if (text) {
        preview.firstPrompt = text.slice(0, FIRST_PROMPT_MAX);
      }
    }
  }
  return preview;
}
