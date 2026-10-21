import type { CodingAgentWithHome } from "@rivus/agent-kit-catalog/spi";
import { CLAUDE_CODE_ID, CLAUDE_CODE_DISPLAY_NAME, CLAUDE_CODE_COMMAND, CLAUDE_CODE_HOME } from "./facts.js";

export const claudeCode: CodingAgentWithHome = {
  id: CLAUDE_CODE_ID,
  displayName: CLAUDE_CODE_DISPLAY_NAME,
  aliases: [CLAUDE_CODE_COMMAND],
  home: CLAUDE_CODE_HOME
};
