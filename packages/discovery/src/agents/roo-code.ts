import type { ProbeRecipe } from "../domain/installation/index.js";

export const rooCodeProbe: ProbeRecipe = {
  specificationVersion: "discovery-v1",
  agent: "roo-code",
  displayName: "Roo Code",
  kind: "extension",
  commands: [],
  appPaths: [],
  configPaths: [
    "~/.roo",
    "~/Library/Application Support/Code/User/globalStorage/rooveterinaryinc.roo-cline",
    "~/.config/Code/User/globalStorage/rooveterinaryinc.roo-cline",
    "~/AppData/Roaming/Code/User/globalStorage/rooveterinaryinc.roo-cline"
  ],
  mcpConfigPaths: [],
  warnings: ["Only VS Code's extension storage is checked, not that of other editors that run the extension."]
};
