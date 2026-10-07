import type { ProbeRecipe } from "../domain/installation/index.js";
import { VERSION_FLAG } from "./version-flag.js";

export const neovateProbe: ProbeRecipe = {
  specificationVersion: "discovery-v1",
  agent: "neovate",
  displayName: "Neovate",
  kind: "cli",
  commands: ["neovate"],
  appPaths: [],
  configPaths: [{ agentHome: "neovate" }],
  mcpConfigPaths: [],
  version: VERSION_FLAG,
  warnings: []
};
