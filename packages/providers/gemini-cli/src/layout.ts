import type { AgentHome } from "@rivus/agent-kit-catalog/spi";

import { basenamePath, joinPath } from "@rivus/agent-kit-sessions/spi";
import {
  GEMINI_CLI_TMP_DIR,
  GEMINI_CLI_CHATS_DIR,
  GEMINI_CLI_JSONL_SUFFIX,
  GEMINI_CLI_JSON_SUFFIX,
  GEMINI_CLI_CHAT_SUFFIX_PATTERN
} from "./facts.js";

export const geminiCliUsageDirectory: string = GEMINI_CLI_TMP_DIR;

// Gemini CLI records each chat under `<home>/tmp/<project>/chats/`: `session-<time>-<id>.jsonl`, and a subagent's chat
// as `<parent session id>/<id>.jsonl` below that directory. Older versions wrote a chat as one JSON object in a `.json`
// file; resuming one migrates it into `<file>.jsonl` and leaves the `.json` file behind.

export function geminiCliUsageRoots(home: AgentHome): string[] {
  return [joinPath(home.path, geminiCliUsageDirectory)];
}

/** How the usage walk finds chat files: `.jsonl` and `.json` files, kept only when they are in a `chats` directory. */
export const GEMINI_CLI_CHAT_FILES: { match(name: string): boolean; maxDepth: number } = {
  match: (name) => name.endsWith(GEMINI_CLI_JSONL_SUFFIX) || name.endsWith(GEMINI_CLI_JSON_SUFFIX),
  maxDepth: 4
};

function isGeminiCliChat(path: string): boolean {
  return path.includes(`/${GEMINI_CLI_CHATS_DIR}/`);
}

/** An older single-object chat, which the `.jsonl` sibling replaces once the chat was resumed. */
export function isGeminiCliLegacyChat(path: string): boolean {
  return path.endsWith(GEMINI_CLI_JSON_SUFFIX);
}

/** The chat file name without its extension, the session's fallback id. */
export function geminiCliSessionStem(path: string): string {
  return basenamePath(path).replace(GEMINI_CLI_CHAT_SUFFIX_PATTERN, "");
}

/**
 * Whether a chat file is a usage source: a chat file at all, and an older `.json` chat only while the `.jsonl` file it
 * was migrated into does not exist among the listed files — its records keep their message ids there.
 */
export function isGeminiCliUsageSource(path: string, listed: ReadonlySet<string>): boolean {
  return isGeminiCliChat(path) && !(isGeminiCliLegacyChat(path) && listed.has(`${path}l`));
}
