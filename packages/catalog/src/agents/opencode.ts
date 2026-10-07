import type { CodingAgent } from "../domain/coding-agent/index.js";

export const opencode: CodingAgent = {
  id: "opencode",
  displayName: "opencode",
  aliases: [],
  // opencode keeps its data in the XDG data directory.
  home: { envVar: "XDG_DATA_HOME", envSubpath: ["opencode"], defaultPath: [".local", "share", "opencode"] }
};
