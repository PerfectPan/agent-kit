import { GROK_DISPLAY_NAME, GROK_HOME, GROK_ID } from "./facts.js";
import { type CodingAgentWithHome } from "@rivus/agent-kit-catalog/spi";

export const grok: CodingAgentWithHome = {
  id: GROK_ID,
  displayName: GROK_DISPLAY_NAME,
  aliases: [],
  home: GROK_HOME
};
