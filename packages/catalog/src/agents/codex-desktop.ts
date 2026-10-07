import type { CodingAgentWithHome } from "../domain/coding-agent/index.js";

export const codexDesktop: CodingAgentWithHome = {
  id: "codex-desktop",
  displayName: "Codex Desktop",
  aliases: [],
  // The Codex app shares the Codex home and CODEX_HOME with the CLI.
  home: { envVar: "CODEX_HOME", defaultPath: [".codex"] }
};
