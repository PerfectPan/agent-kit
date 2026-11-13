import type { CodingAgentWithHome } from "@rivus/agent-kit-catalog/spi";
import { KIMI_DISPLAY_NAME, KIMI_HOME, KIMI_ID } from "./facts.js";

export const kimi: CodingAgentWithHome = {
  id: KIMI_ID,
  displayName: KIMI_DISPLAY_NAME,
  aliases: [],
  home: KIMI_HOME
};
