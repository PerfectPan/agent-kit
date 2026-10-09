import type { CodingAgentWithHome } from "../index.js";

export const opencode: CodingAgentWithHome = {
  id: "opencode",
  displayName: "opencode",
  aliases: [],
  // opencode keeps its data in the XDG data directory.
  home: { envVar: "XDG_DATA_HOME", envSubpath: ["opencode"], defaultPath: [".local", "share", "opencode"] }
};
