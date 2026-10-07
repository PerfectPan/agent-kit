import type { ProbeRecipe } from "../domain/installation/index.js";
import { VERSION_FLAG } from "./version-flag.js";

export const hermesProbe: ProbeRecipe = {
  specificationVersion: "discovery-v1",
  agent: "hermes",
  displayName: "Hermes",
  kind: "cli",
  commands: ["hermes"],
  appPaths: [],
  configPaths: ["~/.hermes"],
  mcpConfigPaths: [],
  version: VERSION_FLAG,
  warnings: ["HERMES_HOME and the Windows default directory are not followed."]
};
