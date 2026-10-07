import type { CodingAgent } from "../domain/coding-agent/index.js";

export const grok: CodingAgent = {
  id: "grok",
  displayName: "Grok",
  aliases: [],
  // GROK_HOME names the Grok home itself.
  home: { envVar: "GROK_HOME", defaultPath: [".grok"] }
};
