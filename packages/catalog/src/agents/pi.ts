import type { CodingAgentWithHome } from "../domain/coding-agent/index.js";

export const pi: CodingAgentWithHome = {
  id: "pi",
  displayName: "Pi",
  aliases: [],
  // PI_CODING_AGENT_DIR names the agent directory (`~/.pi/agent` by default) itself.
  home: { envVar: "PI_CODING_AGENT_DIR", expandsTilde: true, defaultPath: [".pi", "agent"] }
};
