import type { CodingAgentWithHome } from "@rivus/agent-kit-catalog/spi";
import { AGY_DISPLAY_NAME, AGY_HOME, AGY_ID } from "./facts.js";

export const agy: CodingAgentWithHome = {
  id: AGY_ID,
  displayName: AGY_DISPLAY_NAME,
  aliases: [],
  home: AGY_HOME
};
