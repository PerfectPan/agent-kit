import type { CodingAgentWithHome } from "../index.js";

export const claudeCode: CodingAgentWithHome = {
  id: "claude-code",
  displayName: "Claude Code",
  aliases: ["claude"],
  // CLAUDE_CONFIG_DIR names the configuration directory itself.
  home: { envVar: "CLAUDE_CONFIG_DIR", defaultPath: [".claude"] }
};
