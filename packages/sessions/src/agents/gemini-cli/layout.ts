import type { AgentHome } from "@rivus/agent-kit-catalog";

import { basenamePath, joinPath } from "../../domain/session/index.js";

// Gemini CLI records each chat under `<home>/tmp/<project>/chats/`: `session-<time>-<id>.jsonl`, and a subagent's chat
// as `<parent session id>/<id>.jsonl` below that directory. Older versions wrote a chat as one JSON object in a `.json`
// file; resuming one migrates it into `<file>.jsonl` and leaves the `.json` file behind.

export function geminiCliUsageRoots(home: AgentHome): string[] {
  return [joinPath(home.path, "tmp")];
}

/** How the usage walk finds chat files: `.jsonl` and `.json` files, kept only when they are in a `chats` directory. */
export const GEMINI_CLI_CHAT_FILES: { match(name: string): boolean; maxDepth: number } = {
  match: (name) => name.endsWith(".jsonl") || name.endsWith(".json"),
  maxDepth: 4
};

export function isGeminiCliChat(path: string): boolean {
  return path.includes("/chats/");
}

/** An older single-object chat, which the `.jsonl` sibling replaces once the chat was resumed. */
export function isGeminiCliLegacyChat(path: string): boolean {
  return path.endsWith(".json");
}

/** The chat file name without its extension, the session's fallback id. */
export function geminiCliSessionStem(path: string): string {
  return basenamePath(path).replace(/\.jsonl?$/, "");
}
