import {
  DIM_API_KEY_ENVS,
  DIM_AUTH_FILE,
  DIM_COMMAND,
  DIM_CONFIG_FILE,
  DIM_DATABASE_BELOW_HOME,
  DIM_DISPLAY_NAME,
  DIM_HOME,
  DIM_ID,
  DIM_PROVIDERS_FILE
} from "./facts.js";
import type { ProbeRecipe } from "@rivus/agent-kit-discovery/spi";
import { VERSION_FLAG } from "@rivus/agent-kit-discovery/spi";

// `dim --version` prints `dimcode 0.5.27`; the v2 data root carries the SQLite database, the config and provider
// files, and the auth file the cloud login writes. Provider API keys also arrive through the catalog's environment
// variables (`dim provider` reads them when a provider declares `environmentVariableName`).

export const dimProbe: ProbeRecipe = {
  specificationVersion: "discovery-v1",
  agent: DIM_ID,
  displayName: DIM_DISPLAY_NAME,
  kind: "cli",
  commands: [DIM_COMMAND],
  appPaths: [],
  configPaths: [
    { agentHome: DIM_ID, path: DIM_DATABASE_BELOW_HOME },
    { agentHome: DIM_ID, path: DIM_CONFIG_FILE },
    { agentHome: DIM_ID, path: DIM_PROVIDERS_FILE }
  ],
  mcpConfigPaths: [{ agentHome: DIM_ID, path: "mcp.json" }],
  version: { ...VERSION_FLAG },
  auth: {
    credentialFiles: [
      { path: { agentHome: DIM_ID, path: DIM_AUTH_FILE } },
      { path: { agentHome: DIM_ID, path: DIM_PROVIDERS_FILE } }
    ],
    env: DIM_API_KEY_ENVS.map((name) => ({ name, method: "api-key" }))
  },
  warnings: [
    "the project-level provider and hook files (<cwd>/.dimcode/providers.json, .dimcode/hooks.json) are not followed"
  ],
  home: DIM_HOME
};
