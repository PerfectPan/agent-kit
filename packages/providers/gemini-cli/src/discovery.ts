import { type ProbeRecipe, VERSION_FLAG } from "@rivus/agent-kit-discovery/spi";
import {
  GEMINI_CLI_ID,
  GEMINI_CLI_DISPLAY_NAME,
  GEMINI_CLI_COMMAND,
  GEMINI_CLI_CREDENTIAL_FILE,
  GEMINI_CLI_API_KEY_ENV
} from "./facts.js";
import { geminiCliUsageDirectory } from "./layout.js";

export const geminiCliProbe: ProbeRecipe = {
  specificationVersion: "discovery-v1",
  agent: GEMINI_CLI_ID,
  displayName: GEMINI_CLI_DISPLAY_NAME,
  kind: "cli",
  commands: [GEMINI_CLI_COMMAND],
  appPaths: [],
  configPaths: [
    { agentHome: GEMINI_CLI_ID, path: geminiCliUsageDirectory },
    { agentHome: GEMINI_CLI_ID, path: GEMINI_CLI_CREDENTIAL_FILE }
  ],
  mcpConfigPaths: [],
  version: VERSION_FLAG,
  auth: {
    // The OAuth login, unless the user chose encrypted storage in the system keychain.
    credentialFiles: [{ path: { agentHome: GEMINI_CLI_ID, path: GEMINI_CLI_CREDENTIAL_FILE } }],
    env: [{ name: GEMINI_CLI_API_KEY_ENV, method: "api-key" }]
  },
  warnings: []
};
