import type { CodingAgentWithHome } from "../coding-agent/index.js";

export const cline: CodingAgentWithHome = {
  id: "cline",
  displayName: "Cline",
  aliases: [],
  // CLINE_DIR names the Cline directory itself.
  home: { envVar: "CLINE_DIR", defaultPath: [".cline"] }
};
