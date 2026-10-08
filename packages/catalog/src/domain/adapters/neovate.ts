import type { CodingAgentWithHome } from "../coding-agent/index.js";

export const neovate: CodingAgentWithHome = {
  id: "neovate",
  displayName: "Neovate",
  aliases: [],
  // Neovate has no override variable.
  home: { defaultPath: [".neovate"] }
};
