import type { ProbeRecipe } from "../domain/installation/index.js";

export const windsurfProbe: ProbeRecipe = {
  specificationVersion: "discovery-v1",
  agent: "windsurf",
  displayName: "Windsurf",
  kind: "app",
  commands: ["windsurf", "devin-desktop"],
  appPaths: ["/Applications/Windsurf.app", "/Applications/Devin.app"],
  configPaths: ["~/Library/Application Support/Windsurf/User", "~/.config/Windsurf/User", "~/.codeium"],
  mcpConfigPaths: [
    "~/.codeium/windsurf/mcp_config.json",
    "~/Library/Application Support/Windsurf/User/mcp.json",
    "~/.config/devin/mcp_config.json"
  ],
  warnings: ["Windsurf is now Devin Desktop; both names are checked."]
};
