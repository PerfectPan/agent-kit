import type { ProbeRecipe } from "../domain/installation/index.js";

export const clineProbe: ProbeRecipe = {
  specificationVersion: "discovery-v1",
  agent: "cline",
  displayName: "Cline",
  kind: "extension",
  commands: ["cline"],
  appPaths: [],
  configPaths: [
    { agentHome: "cline" },
    "~/Library/Application Support/Code/User/globalStorage/saoudrizwan.claude-dev",
    "~/.config/Code/User/globalStorage/saoudrizwan.claude-dev",
    "~/AppData/Roaming/Code/User/globalStorage/saoudrizwan.claude-dev"
  ],
  mcpConfigPaths: [],
  warnings: ["Only VS Code's extension storage is checked, not that of other editors that run the extension."]
};
