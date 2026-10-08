import type { CodingAgentWithHome } from "../coding-agent/index.js";

export const codebuddy: CodingAgentWithHome = {
  id: "codebuddy",
  displayName: "CodeBuddy",
  aliases: [],
  // CODEBUDDY_CONFIG_DIR names the CodeBuddy directory itself.
  home: { envVar: "CODEBUDDY_CONFIG_DIR", defaultPath: [".codebuddy"] }
};
