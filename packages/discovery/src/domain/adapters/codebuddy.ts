import type { ProbeRecipe } from "../installation/index.js";
import { VERSION_FLAG } from "./version-flag.js";

export const codebuddyProbe: ProbeRecipe = {
  specificationVersion: "discovery-v1",
  agent: "codebuddy",
  displayName: "CodeBuddy",
  kind: "cli",
  commands: ["codebuddy"],
  appPaths: [],
  configPaths: [{ agentHome: "codebuddy" }],
  mcpConfigPaths: [],
  version: VERSION_FLAG,
  warnings: []
};
