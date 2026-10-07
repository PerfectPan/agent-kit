import type { ProbeRecipe } from "../domain/installation/index.js";

export const openhandsProbe: ProbeRecipe = {
  specificationVersion: "discovery-v1",
  agent: "openhands",
  displayName: "OpenHands",
  kind: "app",
  commands: ["openhands"],
  appPaths: [],
  configPaths: [{ agentHome: "openhands" }],
  mcpConfigPaths: [],
  warnings: ["OpenHands may be local, containerized, or remote; discovery is conservative."]
};
