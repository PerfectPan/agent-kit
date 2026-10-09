import type { ClaudeCodeRecordValue } from "./record.js";

/** The fields the prompt rules read, shared by the envelope-checked and the body-only record parses. */
type UserRecord = Pick<ClaudeCodeRecordValue, "isMeta" | "isCompactSummary" | "origin" | "message">;

/** Wrappers the CLI writes for slash commands and `!` shell input. Not prompts. */
const COMMAND_WRAPPER =
  /^\s*<(?:command-name|command-message|command-args|local-command-stdout|local-command-stderr|local-command-caveat|bash-input|bash-stdout|bash-stderr)>/;
/** Text the CLI injects into the user role. Not prompts. */
const INJECTED = /^\s*(?:<task-notification>|<system-reminder>|\[Request interrupted)/;

/** The `MessagePayload` flags that tell a real prompt from other user-role records. */
export interface ClaudeCodeUserFlags {
  meta?: true;
  compactSummary?: true;
  command?: true;
  injected?: true;
}

/** The text of a user record: its string content, or its first text block. Titles and turn flags use this rule. */
export function recordText(record: UserRecord): string | undefined {
  const content = record.message?.content;
  if (typeof content === "string") {
    return content;
  }
  if (!Array.isArray(content)) {
    return undefined;
  }
  for (const block of content) {
    if (block?.type === "text" && block.text !== undefined) {
      return block.text;
    }
  }
  return undefined;
}

export function userFlags(record: UserRecord): ClaudeCodeUserFlags {
  const flags: ClaudeCodeUserFlags = {};
  const text = recordText(record) ?? "";
  if (record.isMeta) {
    flags.meta = true;
  }
  if (record.isCompactSummary) {
    flags.compactSummary = true;
  }
  if (COMMAND_WRAPPER.test(text)) {
    flags.command = true;
  }
  const origin = record.origin?.kind;
  if (INJECTED.test(text) || (origin !== undefined && origin !== "human")) {
    flags.injected = true;
  }
  return flags;
}

export function isPromptFlags(flags: ClaudeCodeUserFlags): boolean {
  return !flags.meta && !flags.compactSummary && !flags.command && !flags.injected;
}
