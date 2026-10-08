import type { CodingAgentWithHome } from "../coding-agent/index.js";

export const geminiCli: CodingAgentWithHome = {
  id: "gemini-cli",
  displayName: "Gemini CLI",
  aliases: ["gemini"],
  // GEMINI_CLI_HOME replaces the user's home directory; the CLI appends `.gemini` to it.
  home: { envVar: "GEMINI_CLI_HOME", envSubpath: [".gemini"], defaultPath: [".gemini"] }
};
