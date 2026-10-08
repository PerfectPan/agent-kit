import type { ProbeRecipe } from "../installation/index.js";

export const codexDesktopProbe: ProbeRecipe = {
  specificationVersion: "discovery-v1",
  agent: "codex-desktop",
  displayName: "Codex Desktop",
  kind: "app",
  commands: [],
  // The Codex app installs as ChatGPT.app. Its home is the Codex CLI's, which running codex creates, so only the
  // application counts as evidence.
  appPaths: ["/Applications/Codex.app", "/Applications/ChatGPT.app"],
  appBundleIds: ["com.openai.codex"],
  configPaths: [],
  mcpConfigPaths: [],
  warnings: [
    "When an app's Info.plist cannot be read, its path alone counts, and ChatGPT.app may be a ChatGPT app without Codex."
  ]
};
