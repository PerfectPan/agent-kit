import type { ProbeRecipe } from "../installation/index.js";

export const vscodeCopilotProbe: ProbeRecipe = {
  specificationVersion: "discovery-v1",
  agent: "vscode-copilot",
  displayName: "VS Code Copilot",
  kind: "extension",
  commands: ["code"],
  appPaths: [],
  configPaths: ["~/Library/Application Support/Code/User", "~/.config/Code/User", "~/AppData/Roaming/Code/User"],
  mcpConfigPaths: ["~/Library/Application Support/Code/User/mcp.json"],
  warnings: ["VS Code Copilot extension presence is not validated without reading extension metadata."]
};
