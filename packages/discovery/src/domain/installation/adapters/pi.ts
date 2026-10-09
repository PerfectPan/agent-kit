import type { ProbeRecipe } from "../index.js";
import { VERSION_FLAG } from "./version-flag.js";

export const piProbe: ProbeRecipe = {
  specificationVersion: "discovery-v1",
  agent: "pi",
  displayName: "Pi",
  kind: "cli",
  commands: ["pi"],
  appPaths: [],
  configPaths: [{ agentHome: "pi" }],
  mcpConfigPaths: [],
  version: VERSION_FLAG,
  warnings: []
};
