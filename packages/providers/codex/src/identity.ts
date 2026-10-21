import { CODEX_ID, CODEX_DISPLAY_NAME, CODEX_HOME } from "./facts.js";
import { type CodingAgentWithHome } from "@rivus/agent-kit-catalog/spi";

export const codex: CodingAgentWithHome = {
  id: CODEX_ID,
  displayName: CODEX_DISPLAY_NAME,
  aliases: [],
  home: CODEX_HOME
};
