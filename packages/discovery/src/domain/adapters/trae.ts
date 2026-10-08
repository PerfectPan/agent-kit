import type { ProbeRecipe } from "../installation/index.js";

export const traeProbe: ProbeRecipe = {
  specificationVersion: "discovery-v1",
  agent: "trae",
  displayName: "Trae",
  kind: "app",
  commands: ["trae", "trae-cn"],
  appPaths: [],
  configPaths: ["~/.trae", "~/.trae-cn"],
  mcpConfigPaths: [],
  warnings: []
};
