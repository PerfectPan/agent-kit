import type { CodingAgent } from "../domain/coding-agent/index.js";

export const claudeCode: CodingAgent = {
  id: "claude-code",
  displayName: "Claude Code",
  aliases: ["claude"],
  // CLAUDE_CONFIG_DIR names the configuration directory itself.
  home: { envVar: "CLAUDE_CONFIG_DIR", defaultPath: [".claude"] }
};
