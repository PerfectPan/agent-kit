import type { ProbeRecipe } from "@rivus/agent-kit-discovery/spi";
import { VERSION_FLAG } from "@rivus/agent-kit-discovery/spi";
import {
  COPILOT_COMMAND,
  COPILOT_CONFIG_FILE,
  COPILOT_DISPLAY_NAME,
  COPILOT_HOME,
  COPILOT_ID,
  COPILOT_MCP_CONFIG_FILE,
  COPILOT_SETTINGS_FILE
} from "./facts.js";

// `copilot --version` prints `GitHub Copilot CLI <semver>.`. Configuration and session state live under `~/.copilot`
// (moved by `COPILOT_HOME`). OAuth tokens live in the OS keychain when signed in via `copilot login`, so only
// explicit token environment variables are observed here as auth evidence.

export const copilotProbe: ProbeRecipe = {
  specificationVersion: "discovery-v1",
  agent: COPILOT_ID,
  displayName: COPILOT_DISPLAY_NAME,
  kind: "cli",
  commands: [COPILOT_COMMAND],
  appPaths: [],
  configPaths: [
    { agentHome: COPILOT_ID, path: COPILOT_CONFIG_FILE },
    { agentHome: COPILOT_ID, path: COPILOT_SETTINGS_FILE }
  ],
  mcpConfigPaths: [{ agentHome: COPILOT_ID, path: COPILOT_MCP_CONFIG_FILE }],
  version: { ...VERSION_FLAG },
  auth: {
    env: [
      { name: "COPILOT_GITHUB_TOKEN", method: "token" },
      { name: "GH_TOKEN", method: "token" },
      { name: "GITHUB_TOKEN", method: "token" }
    ]
  },
  warnings: [
    "keychain-backed `copilot login` sessions are not probed directly; only token environment variables report login"
  ],
  home: COPILOT_HOME
};
