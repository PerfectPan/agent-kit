import type { ProbeRecipe } from "../domain/installation/index.js";
import { VERSION_FLAG } from "./version-flag.js";

export const githubCopilotProbe: ProbeRecipe = {
  specificationVersion: "discovery-v1",
  agent: "github-copilot",
  displayName: "GitHub Copilot",
  kind: "cli",
  commands: ["copilot"],
  appPaths: [],
  configPaths: [{ agentHome: "github-copilot" }],
  mcpConfigPaths: [],
  version: {
    ...VERSION_FLAG,
    sideEffects: ["Unpacks the CLI's package under the user's cache directory, ~/Library/Caches/copilot on macOS."]
  },
  warnings: []
};
