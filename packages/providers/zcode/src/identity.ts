import type { CodingAgentWithHome } from "@rivus/agent-kit-catalog/spi";
import { ZCODE_DISPLAY_NAME, ZCODE_HOME, ZCODE_ID } from "./facts.js";

export const zcode: CodingAgentWithHome = {
  id: ZCODE_ID,
  displayName: ZCODE_DISPLAY_NAME,
  aliases: [],
  home: ZCODE_HOME
};
