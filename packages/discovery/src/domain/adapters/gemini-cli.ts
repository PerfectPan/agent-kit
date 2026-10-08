import type { ProbeRecipe } from "../installation/index.js";
import { VERSION_FLAG } from "./version-flag.js";

export const geminiCliProbe: ProbeRecipe = {
  specificationVersion: "discovery-v1",
  agent: "gemini-cli",
  displayName: "Gemini CLI",
  kind: "cli",
  commands: ["gemini"],
  appPaths: [],
  configPaths: [{ agentHome: "gemini-cli" }],
  mcpConfigPaths: [{ agentHome: "gemini-cli", path: "settings.json" }],
  version: VERSION_FLAG,
  auth: {
    // The OAuth login, unless the user chose encrypted storage in the system keychain.
    credentialFiles: [{ path: { agentHome: "gemini-cli", path: "oauth_creds.json" } }],
    env: [{ name: "GEMINI_API_KEY", method: "api-key" }]
  },
  warnings: []
};
