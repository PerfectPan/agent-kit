import type { CodingAgentWithHome } from "../coding-agent/index.js";

export const openhands: CodingAgentWithHome = {
  id: "openhands",
  displayName: "OpenHands",
  aliases: [],
  // OPENHANDS_PERSISTENCE_DIR names the OpenHands directory itself.
  home: { envVar: "OPENHANDS_PERSISTENCE_DIR", defaultPath: [".openhands"] }
};
