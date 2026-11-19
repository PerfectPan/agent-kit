import {
  AGY_CLI_SETTINGS_FILE,
  AGY_COMMAND,
  AGY_DISPLAY_NAME,
  AGY_HISTORY_FILE,
  AGY_HOME,
  AGY_ID,
  AGY_ONBOARDING_STATE_FILE
} from "./facts.js";
import type { ProbeRecipe } from "@rivus/agent-kit-discovery/spi";
import { VERSION_FLAG } from "@rivus/agent-kit-discovery/spi";

// `agy --version` prints the version. The CLI keeps its own state under `~/.gemini/antigravity-cli` and talks to
// Google's Cloud Code API after a Google login (`agy acp --login`); the login material itself stays out of the
// directories detection reads, so only the API-key variables count as an observed login here.

export const agyProbe: ProbeRecipe = {
  specificationVersion: "discovery-v1",
  agent: AGY_ID,
  displayName: AGY_DISPLAY_NAME,
  kind: "cli",
  commands: [AGY_COMMAND],
  appPaths: [],
  configPaths: [
    { agentHome: AGY_ID, path: AGY_CLI_SETTINGS_FILE },
    { agentHome: AGY_ID, path: AGY_HISTORY_FILE },
    { agentHome: AGY_ID, path: AGY_ONBOARDING_STATE_FILE }
  ],
  mcpConfigPaths: [],
  version: { ...VERSION_FLAG },
  auth: {
    env: [
      { name: "GEMINI_API_KEY", method: "api-key" },
      { name: "GOOGLE_APPLICATION_CREDENTIALS", method: "service-account" }
    ]
  },
  warnings: [
    "the config root override ANTIGRAVITY_GEMINI_DIR is read from the binary strings; the CLI does not document it",
    "the per-conversation SQLite stores and the hooks.json files are formats this provider does not read yet"
  ],
  home: AGY_HOME
};
