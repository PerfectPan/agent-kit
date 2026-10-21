import type { CodingAgentWithHome } from "@rivus/agent-kit-catalog/spi";
import { OPENCODE_ID, OPENCODE_HOME } from "./facts.js";

export const opencode: CodingAgentWithHome = {
  id: OPENCODE_ID,
  displayName: OPENCODE_ID,
  aliases: [],
  home: OPENCODE_HOME
};
