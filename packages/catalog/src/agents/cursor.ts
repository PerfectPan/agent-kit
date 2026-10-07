import type { CodingAgent } from "../domain/coding-agent/index.js";

export const cursor: CodingAgent = {
  id: "cursor",
  displayName: "Cursor",
  aliases: [],
  // User-level hooks, rules and MCP configuration live under `~/.cursor`; no variable moves it.
  home: { defaultPath: [".cursor"] }
};
