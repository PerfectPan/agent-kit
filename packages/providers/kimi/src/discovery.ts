import {
  KIMI_CREDENTIALS_DIR,
  KIMI_DISPLAY_NAME,
  KIMI_HOME,
  KIMI_ID,
  KIMI_MCP_FILE,
  KIMI_MODEL_API_KEY_ENV,
  KIMI_SESSIONS_DIR
} from "./facts.js";
import type { ProbeRecipe } from "@rivus/agent-kit-discovery/spi";
import { VERSION_FLAG } from "@rivus/agent-kit-discovery/spi";

// https://www.kimi.com/code/docs/en/kimi-code-cli/configuration/data-locations.html (directory layout) and
// /configuration/env-vars.html (KIMI_MODEL_* is the only credential the CLI reads from the environment).

export const kimiProbe: ProbeRecipe = {
  specificationVersion: "discovery-v1",
  agent: KIMI_ID,
  displayName: KIMI_DISPLAY_NAME,
  kind: "cli",
  commands: ["kimi"],
  appPaths: [],
  configPaths: [
    { agentHome: KIMI_ID, path: KIMI_SESSIONS_DIR },
    { agentHome: KIMI_ID, path: KIMI_CREDENTIALS_DIR }
  ],
  mcpConfigPaths: [{ agentHome: KIMI_ID, path: KIMI_MCP_FILE }],
  version: { ...VERSION_FLAG },
  auth: {
    // Provider credentials sit at credentials/<name>.json; the kit cannot list the directory, so it probes the
    // documented names and leaves the directory as config evidence.
    credentialFiles: [
      { path: { agentHome: KIMI_ID, path: "credentials/kimi-code.json" } },
      { path: { agentHome: KIMI_ID, path: "credentials/kimi.json" } }
    ],
    env: [{ name: KIMI_MODEL_API_KEY_ENV, method: "api-key" }]
  },
  warnings: [],
  home: KIMI_HOME
};
