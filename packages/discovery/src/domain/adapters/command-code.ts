import type { ProbeRecipe } from "../installation/index.js";
import { VERSION_FLAG } from "./version-flag.js";

export const commandCodeProbe: ProbeRecipe = {
  specificationVersion: "discovery-v1",
  agent: "command-code",
  displayName: "Command Code",
  kind: "cli",
  commands: ["command-code", "commandcode"],
  appPaths: [],
  configPaths: ["~/.commandcode"],
  mcpConfigPaths: [],
  version: VERSION_FLAG,
  warnings: []
};
