import { QODER_COMMAND, QODER_DISPLAY_NAME, QODER_HOME, QODER_ID, QODER_OAUTH_FILE, QODER_PAT_ENV } from "./facts.js";
import type { ProbeRecipe } from "@rivus/agent-kit-discovery/spi";
import { VERSION_FLAG } from "@rivus/agent-kit-discovery/spi";

// `qodercli --version` prints the version; `~/.qoder` holds `settings.json`, `oauth_creds.json` and the versioned
// binary store. Login is a Qoder account (`qodercli login`); a Personal Access Token (qoder.com/account/integrations)
// arrives through `QODER_PERSONAL_ACCESS_TOKEN` (agent SDK README).

export const qoderProbe: ProbeRecipe = {
  specificationVersion: "discovery-v1",
  agent: QODER_ID,
  displayName: QODER_DISPLAY_NAME,
  kind: "cli",
  commands: [QODER_COMMAND],
  appPaths: [],
  configPaths: [{ agentHome: QODER_ID, path: QODER_OAUTH_FILE }],
  mcpConfigPaths: [],
  version: { ...VERSION_FLAG },
  auth: {
    credentialFiles: [{ path: { agentHome: QODER_ID, path: QODER_OAUTH_FILE } }],
    env: [{ name: QODER_PAT_ENV, method: "personal-access-token" }]
  },
  warnings: [
    "the user config root override is one of QODER_CONFIG_DIR / QODER_USER_CONFIG_DIR; the binary carries both names"
  ],
  home: QODER_HOME
};
