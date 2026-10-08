import type { ProbeRecipe } from "../installation/index.js";
import { VERSION_FLAG } from "./version-flag.js";

export const ampProbe: ProbeRecipe = {
  specificationVersion: "discovery-v1",
  agent: "amp",
  displayName: "Amp",
  kind: "cli",
  commands: ["amp"],
  appPaths: [],
  configPaths: ["~/.config/amp"],
  mcpConfigPaths: [],
  version: VERSION_FLAG,
  auth: { credentialFiles: [{ path: "~/.local/share/amp/secrets.json" }] },
  warnings: []
};
