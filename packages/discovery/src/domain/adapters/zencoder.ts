import type { ProbeRecipe } from "../installation/index.js";
import { VERSION_FLAG } from "./version-flag.js";

export const zencoderProbe: ProbeRecipe = {
  specificationVersion: "discovery-v1",
  agent: "zencoder",
  displayName: "Zencoder",
  kind: "cli",
  commands: ["zencoder"],
  appPaths: [],
  configPaths: ["~/.zencoder"],
  mcpConfigPaths: [],
  version: VERSION_FLAG,
  warnings: ["Unverified: the command name, which may be zen, and the configuration directory."]
};
