import type { SessionHead } from "../value-objects/session-head.js";
import type { SessionPreview } from "../value-objects/session-preview.js";
import type { SessionRef } from "../value-objects/session-ref.js";

/** The most characters of a head's title. */
export const SESSION_TITLE_MAX = 80;

/**
 * The head listing produces for one session file: the agent's own title, else its first prompt, cut to
 * `SESSION_TITLE_MAX` characters; its cwd, start, and first prompt as the preview read them; and its last record
 * time, else the file's modification time.
 */
export function sessionHead(
  ref: SessionRef,
  preview: SessionPreview,
  file: { readonly sizeBytes: number; readonly mtimeMs: number }
): SessionHead {
  const head: SessionHead = {
    ref,
    lastActiveAt: preview.lastAt ?? file.mtimeMs,
    sizeBytes: file.sizeBytes
  };
  const title = preview.title ?? preview.firstPrompt;
  if (title) {
    head.title = title.slice(0, SESSION_TITLE_MAX);
  }
  if (preview.cwd) {
    head.cwd = preview.cwd;
  }
  if (preview.startedAt !== undefined) {
    head.startedAt = preview.startedAt;
  }
  if (preview.firstPrompt) {
    head.firstPrompt = preview.firstPrompt;
  }
  return head;
}
