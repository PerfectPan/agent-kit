import type { CodingAgentWithHome } from "../index.js";

export const grok: CodingAgentWithHome = {
  id: "grok",
  displayName: "Grok",
  aliases: [],
  // GROK_HOME names the Grok home itself.
  home: { envVar: "GROK_HOME", defaultPath: [".grok"] }
};
