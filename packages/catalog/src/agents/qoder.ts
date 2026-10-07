import type { CodingAgentWithHome } from "../domain/coding-agent/index.js";

export const qoder: CodingAgentWithHome = {
  id: "qoder",
  displayName: "Qoder",
  aliases: [],
  // QODER_CONFIG_DIR names the Qoder directory itself.
  home: { envVar: "QODER_CONFIG_DIR", defaultPath: [".qoder"] }
};
