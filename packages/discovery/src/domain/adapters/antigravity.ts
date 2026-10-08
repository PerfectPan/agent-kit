import type { ProbeRecipe } from "../installation/index.js";

export const antigravityProbe: ProbeRecipe = {
  specificationVersion: "discovery-v1",
  agent: "antigravity",
  displayName: "Antigravity",
  kind: "app",
  commands: ["agy"],
  appPaths: [],
  configPaths: [
    "~/.gemini/antigravity-cli",
    "~/Library/Application Support/Antigravity/User",
    "~/.config/Antigravity/User",
    "~/AppData/Roaming/Antigravity/User"
  ],
  mcpConfigPaths: [],
  warnings: [
    "Unverified: the application's user directories and application path; only the CLI directory is documented."
  ]
};
