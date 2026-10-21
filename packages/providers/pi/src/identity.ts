import type { CodingAgentWithHome } from "@rivus/agent-kit-catalog/spi";
import { PI_ID, PI_DISPLAY_NAME, PI_HOME } from "./facts.js";

export const pi: CodingAgentWithHome = {
  id: PI_ID,
  displayName: PI_DISPLAY_NAME,
  aliases: [],
  home: PI_HOME
};
