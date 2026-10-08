import type { CodingAgentWithHome } from "../coding-agent/index.js";

export const kiroCli: CodingAgentWithHome = {
  id: "kiro-cli",
  displayName: "Kiro CLI",
  aliases: [],
  // KIRO_HOME names the Kiro directory itself.
  home: { envVar: "KIRO_HOME", defaultPath: [".kiro"] }
};
