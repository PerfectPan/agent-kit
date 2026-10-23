import type { ClaudeCodeRecordValue } from "../records/record.js";

/** The fields the prompt rules read, shared by the envelope-checked and the body-only record parses. */
type UserRecord = Pick<ClaudeCodeRecordValue, "isMeta" | "isCompactSummary" | "origin" | "message">;

/** Wrappers the CLI writes for slash commands and `!` shell input. Not prompts. */
const COMMAND_WRAPPER =
  /^\s*<(?:command-name|command-message|command-args|local-command-stdout|local-command-stderr|local-command-caveat|bash-input|bash-stdout|bash-stderr)>/;
/** Text the CLI injects into the user role. Not prompts. */
const INJECTED = /^\s*(?:<task-notification>|<system-reminder>|\[Request interrupted)/;
/** Host context the CLI adds around the user's text: the IDE's opened file and selection, and a fork's scaffolding. Not prompts. */
const HOST_CONTEXT = /^\s*<(?:ide_opened_file|ide_selection|fork-boilerplate)>/;

/** A text block the host adds, so it is no part of the user's prompt, alone or beside the user's own blocks. */
export function isHostAddedText(text: string): boolean {
  return INJECTED.test(text) || HOST_CONTEXT.test(text);
}

/** The `MessagePayload` flags that tell a real prompt from other user-role records. */
export interface ClaudeCodeUserFlags {
  meta?: true;
  compactSummary?: true;
  command?: true;
  injected?: true;
}

/** The texts of a record's blocks: its string content as the only block, else its text blocks in order. */
function blockTexts(record: UserRecord): string[] {
  const content = record.message?.content;
  if (typeof content === "string") {
    return [content];
  }
  if (!Array.isArray(content)) {
    return [];
  }
  const texts: string[] = [];
  for (const block of content) {
    if (block?.type === "text" && block.text !== undefined) {
      texts.push(block.text);
    }
  }
  return texts;
}

/**
 * The prompt text of a user record: its blocks that are not host-added, each trimmed, joined with a blank line.
 * `undefined` when none remains, so a record the host filled entirely, or whose own text is only whitespace,
 * collects no prompt and no title.
 */
export function recordText(record: UserRecord): string | undefined {
  const own = blockTexts(record)
    .filter((text) => !isHostAddedText(text))
    .map((text) => text.trim())
    .filter((text) => text !== "");
  return own.length === 0 ? undefined : own.join("\n\n");
}

export function userFlags(record: UserRecord): ClaudeCodeUserFlags {
  const flags: ClaudeCodeUserFlags = {};
  if (record.isMeta) {
    flags.meta = true;
  }
  if (record.isCompactSummary) {
    flags.compactSummary = true;
  }
  const texts = blockTexts(record);
  const own = texts.find((text) => !isHostAddedText(text));
  if (own !== undefined && COMMAND_WRAPPER.test(own)) {
    flags.command = true;
  }
  const origin = record.origin?.kind;
  // A record without a text block, such as an image-only one, is a prompt without text, not an injected one.
  if ((texts.length > 0 && texts.every(isHostAddedText)) || (origin !== undefined && origin !== "human")) {
    flags.injected = true;
  }
  return flags;
}

export function isPromptFlags(flags: ClaudeCodeUserFlags): boolean {
  return !flags.meta && !flags.compactSummary && !flags.command && !flags.injected;
}
