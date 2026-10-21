import type { CodingAgent } from "@rivus/agent-kit-catalog/spi";
import { CURSOR_ID, CURSOR_DISPLAY_NAME, CURSOR_AGENT_COMMAND } from "./facts.js";

export const cursor: CodingAgent = {
  id: CURSOR_ID,
  displayName: CURSOR_DISPLAY_NAME,
  aliases: [CURSOR_AGENT_COMMAND]
};
