import type { CodingAgentWithHome } from "../domain/coding-agent/index.js";

export const codex: CodingAgentWithHome = {
  id: "codex",
  displayName: "Codex",
  aliases: [],
  // CODEX_HOME names the Codex home itself.
  home: { envVar: "CODEX_HOME", defaultPath: [".codex"] }
};
