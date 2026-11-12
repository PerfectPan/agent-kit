import type { CodingAgentWithHome } from "@rivus/agent-kit-catalog/spi";
import { QODER_DISPLAY_NAME, QODER_HOME, QODER_ID } from "./facts.js";

export const qoder: CodingAgentWithHome = {
  id: QODER_ID,
  displayName: QODER_DISPLAY_NAME,
  aliases: [],
  home: QODER_HOME
};
