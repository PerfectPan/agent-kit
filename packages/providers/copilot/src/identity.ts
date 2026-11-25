import type { CodingAgentWithHome } from "@rivus/agent-kit-catalog/spi";
import { COPILOT_DISPLAY_NAME, COPILOT_HOME, COPILOT_ID } from "./facts.js";

export const copilot: CodingAgentWithHome = {
  id: COPILOT_ID,
  displayName: COPILOT_DISPLAY_NAME,
  aliases: [],
  home: COPILOT_HOME
};
