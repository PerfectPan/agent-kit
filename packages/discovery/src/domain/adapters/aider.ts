import type { ProbeRecipe } from "../installation/index.js";
import { VERSION_FLAG } from "./version-flag.js";

export const aiderProbe: ProbeRecipe = {
  specificationVersion: "discovery-v1",
  agent: "aider",
  displayName: "aider",
  kind: "cli",
  commands: ["aider"],
  appPaths: [],
  configPaths: ["~/.aider.conf.yml", "~/.aider"],
  mcpConfigPaths: [],
  version: VERSION_FLAG,
  warnings: []
};
