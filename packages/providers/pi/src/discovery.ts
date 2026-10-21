import { type ProbeRecipe, VERSION_FLAG } from "@rivus/agent-kit-discovery/spi";
import { PI_ID, PI_DISPLAY_NAME } from "./facts.js";
import { piSessionDirectory } from "./layout.js";

export const piProbe: ProbeRecipe = {
  specificationVersion: "discovery-v1",
  agent: PI_ID,
  displayName: PI_DISPLAY_NAME,
  kind: "cli",
  commands: [PI_ID],
  appPaths: [],
  configPaths: [{ agentHome: PI_ID, path: piSessionDirectory }],
  mcpConfigPaths: [],
  version: VERSION_FLAG,
  warnings: []
};
