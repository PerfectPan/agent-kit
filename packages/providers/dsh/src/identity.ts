import type { CodingAgentWithHome } from "@rivus/agent-kit-catalog/spi";

import { DSH_DISPLAY_NAME, DSH_HOME, DSH_ID } from "./facts.js";

export const dsh: CodingAgentWithHome = {
  id: DSH_ID,
  displayName: DSH_DISPLAY_NAME,
  aliases: [],
  home: DSH_HOME
};
