import type { CodingAgentWithHome } from "@rivus/agent-kit-catalog/spi";
import { DIM_DISPLAY_NAME, DIM_HOME, DIM_ID } from "./facts.js";

export const dim: CodingAgentWithHome = {
  id: DIM_ID,
  displayName: DIM_DISPLAY_NAME,
  aliases: [],
  home: DIM_HOME
};
