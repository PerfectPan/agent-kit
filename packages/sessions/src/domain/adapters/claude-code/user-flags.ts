import { asRecord, asString } from "../../protocols/record-fields.js";

/** Wrappers the CLI writes for slash commands and `!` shell input. Not prompts. */
const COMMAND_WRAPPER =
  /^\s*<(?:command-name|command-message|command-args|local-command-stdout|local-command-stderr|local-command-caveat|bash-input|bash-stdout|bash-stderr)>/;
/** Text the CLI injects into the user role. Not prompts. */
const INJECTED = /^\s*(?:<task-notification>|<system-reminder>|\[Request interrupted)/;

/** The text of a user record: its string content, or its first text block. Titles and turn flags use this rule. */
export function recordText(content: unknown): string | undefined {
  if (typeof content === "string") {
    return content;
  }
  if (!Array.isArray(content)) {
    return undefined;
  }
  for (const block of content) {
    const item = asRecord(block);
    if (item?.type === "text" && typeof item.text === "string") {
      return item.text;
    }
  }
  return undefined;
}

/** The `MessagePayload` flags that tell a real prompt from other user-role records. */
export function userFlags(record: Record<string, unknown>, content: unknown): Record<string, unknown> {
  const flags: Record<string, unknown> = {};
  const text = recordText(content) ?? "";
  if (record.isMeta === true) {
    flags.meta = true;
  }
  if (record.isCompactSummary === true) {
    flags.compactSummary = true;
  }
  if (COMMAND_WRAPPER.test(text)) {
    flags.command = true;
  }
  const origin = asString(asRecord(record.origin)?.kind);
  if (INJECTED.test(text) || (origin !== undefined && origin !== "human")) {
    flags.injected = true;
  }
  return flags;
}

export function isPromptFlags(flags: Record<string, unknown>): boolean {
  return !flags.meta && !flags.compactSummary && !flags.command && !flags.injected;
}
