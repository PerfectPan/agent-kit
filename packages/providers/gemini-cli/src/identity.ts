import type { CodingAgentWithHome } from "@rivus/agent-kit-catalog/spi";
import { GEMINI_CLI_ID, GEMINI_CLI_DISPLAY_NAME, GEMINI_CLI_COMMAND, GEMINI_CLI_HOME } from "./facts.js";

export const geminiCli: CodingAgentWithHome = {
  id: GEMINI_CLI_ID,
  displayName: GEMINI_CLI_DISPLAY_NAME,
  aliases: [GEMINI_CLI_COMMAND],
  home: GEMINI_CLI_HOME
};
