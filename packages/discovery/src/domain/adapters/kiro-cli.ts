import type { ProbeRecipe } from "../installation/index.js";
import { VERSION_FLAG } from "./version-flag.js";

export const kiroCliProbe: ProbeRecipe = {
  specificationVersion: "discovery-v1",
  agent: "kiro-cli",
  displayName: "Kiro CLI",
  kind: "cli",
  commands: ["kiro-cli"],
  appPaths: [],
  configPaths: [{ agentHome: "kiro-cli" }],
  mcpConfigPaths: [],
  version: VERSION_FLAG,
  warnings: []
};
