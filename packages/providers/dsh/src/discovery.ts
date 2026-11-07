import { type ProbeRecipe, VERSION_FLAG } from "@rivus/agent-kit-discovery/spi";
import {
  DSH_API_KEY_ENV,
  DSH_COMMAND,
  DSH_CREDENTIAL_FILE,
  DSH_DISPLAY_NAME,
  DSH_ID,
  DSH_SESSIONS_DIR
} from "./facts.js";

// `@deepseek-ai/dsh` (0.2.1-rc.3): `dsh --version` prints the runtime version; the home is `$DSH_HOME` or `~/.dsh`.
// The home itself is no evidence: skill installers write `<home>/skills` for agents that never ran.
export const dshProbe: ProbeRecipe = {
  specificationVersion: "discovery-v1",
  agent: DSH_ID,
  displayName: DSH_DISPLAY_NAME,
  kind: "cli",
  commands: [DSH_COMMAND],
  appPaths: [],
  configPaths: [
    { agentHome: DSH_ID, path: DSH_SESSIONS_DIR },
    { agentHome: DSH_ID, path: DSH_CREDENTIAL_FILE }
  ],
  mcpConfigPaths: [],
  version: VERSION_FLAG,
  auth: {
    credentialFiles: [{ path: { agentHome: DSH_ID, path: DSH_CREDENTIAL_FILE } }],
    env: [{ name: DSH_API_KEY_ENV, method: "api-key" }]
  },
  warnings: [
    "The credential file is YAML, so its existence alone counts as a login; its values are never read.",
    "A key only in `$DSH_HOME/.env` or a project's `.env` is not checked, so the login reads as unknown."
  ]
};
