import type { CodingAgentWithHome } from "../domain/coding-agent/index.js";

export const githubCopilot: CodingAgentWithHome = {
  id: "github-copilot",
  displayName: "GitHub Copilot",
  aliases: [],
  // COPILOT_HOME names the Copilot CLI directory itself.
  home: { envVar: "COPILOT_HOME", defaultPath: [".copilot"] }
};
