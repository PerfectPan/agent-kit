import { SESSION_TITLE_MAX, type SessionPreview } from "@rivus/agent-kit-sessions/spi";

import { dshContentParts, dshEventOf, dshHeaderOf, dshTitleOf, dshUserMessageOf } from "../records.js";

const FIRST_PROMPT_MAX = 500;

/** The listing preview of a decoded log prefix: header identity, title, first human prompt and time bounds. */
export function previewDshText(text: string): SessionPreview {
  const preview: SessionPreview = {};
  for (const line of text.split("\n")) {
    if (line.trim().length === 0) {
      continue;
    }
    let value: unknown;
    try {
      value = JSON.parse(line) as unknown;
    } catch {
      continue;
    }
    const header = dshHeaderOf(value);
    if (header !== undefined) {
      if (header.id) {
        preview.sessionId = header.id;
      }
      if (header.cwd) {
        preview.cwd = header.cwd;
      }
      if (header.createdAt !== undefined) {
        preview.startedAt = header.createdAt;
      }
    }
    const event = dshEventOf(value);
    if (event === undefined) {
      continue;
    }
    if (event.time !== undefined) {
      preview.startedAt = preview.startedAt === undefined ? event.time : Math.min(preview.startedAt, event.time);
      preview.lastAt = preview.lastAt === undefined ? event.time : Math.max(preview.lastAt, event.time);
    }
    if (event.type === "session/title") {
      const title = dshTitleOf(event.data);
      if (title) {
        preview.title = title.slice(0, SESSION_TITLE_MAX);
      }
    }
    if (preview.firstPrompt === undefined && event.type === "user/message") {
      const message = dshUserMessageOf(event.data);
      if (message?.source?.kind === "user") {
        const text = dshContentParts(message.content)
          .filter((part) => part.kind === "text")
          .map((part) => part.text)
          .join("\n")
          .trim();
        if (text) {
          preview.firstPrompt = text.slice(0, FIRST_PROMPT_MAX);
        }
      }
    }
  }
  return preview;
}
