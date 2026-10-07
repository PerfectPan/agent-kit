import type { CodingAgent } from "../domain/coding-agent/index.js";

export const cursor: CodingAgent = {
  id: "cursor",
  displayName: "Cursor",
  aliases: ["cursor-agent"],
  // Only the default: Cursor also honors CURSOR_CONFIG_DIR and then $XDG_CONFIG_HOME/cursor, two fallbacks that one
  // HomeRule cannot express.
  home: { defaultPath: [".cursor"] }
};
