import type { ProbeRecipe } from "../domain/installation/index.js";
import { VERSION_FLAG } from "./version-flag.js";

export const kimiCodeCliProbe: ProbeRecipe = {
  specificationVersion: "discovery-v1",
  agent: "kimi-code-cli",
  displayName: "Kimi Code CLI",
  kind: "cli",
  commands: ["kimi"],
  appPaths: [],
  configPaths: [{ agentHome: "kimi-code-cli" }],
  mcpConfigPaths: [],
  version: VERSION_FLAG,
  warnings: []
};
