import type { CodingAgentWithHome } from "../domain/coding-agent/index.js";

export const kimiCodeCli: CodingAgentWithHome = {
  id: "kimi-code-cli",
  displayName: "Kimi Code CLI",
  aliases: ["kimi"],
  // KIMI_SHARE_DIR names the Kimi directory itself.
  home: { envVar: "KIMI_SHARE_DIR", defaultPath: [".kimi"] }
};
