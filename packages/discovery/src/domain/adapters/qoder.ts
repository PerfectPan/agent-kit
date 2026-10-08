import type { ProbeRecipe } from "../installation/index.js";
import { VERSION_FLAG } from "./version-flag.js";

export const qoderProbe: ProbeRecipe = {
  specificationVersion: "discovery-v1",
  agent: "qoder",
  displayName: "Qoder",
  kind: "cli",
  commands: ["qoder", "qodercli"],
  appPaths: [],
  configPaths: [{ agentHome: "qoder" }],
  mcpConfigPaths: [],
  version: VERSION_FLAG,
  warnings: []
};
