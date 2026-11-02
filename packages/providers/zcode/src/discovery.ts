import * as z from "zod/mini";

import { type AuthReading, type ProbeRecipe, VERSION_FLAG } from "@rivus/agent-kit-discovery/spi";
import { ZCODE_CREDENTIAL_FILE, ZCODE_CREDENTIAL_KEYS, ZCODE_DISPLAY_NAME, ZCODE_ID } from "./facts.js";
import { zcodeDatabaseBelowHome } from "./layout.js";

const Entries = z.record(z.string(), z.unknown());

/**
 * Reads ZCode's shared `credentials.json`, a flat record of login entries. Only whether one of the known access-token
 * or JWT keys holds a non-empty string is used; no value is ever returned.
 */
export function parseZcodeCredentials(json: unknown): AuthReading | undefined {
  const parsed = Entries.safeParse(json);
  if (!parsed.success) {
    return undefined;
  }
  const loggedIn = ZCODE_CREDENTIAL_KEYS.some((key) => typeof parsed.data[key] === "string" && parsed.data[key] !== "");
  return { loggedIn };
}

export const zcodeProbe: ProbeRecipe = {
  specificationVersion: "discovery-v1",
  agent: ZCODE_ID,
  displayName: ZCODE_DISPLAY_NAME,
  // The desktop app ships the CLI engine at Contents/Resources/glm/zcode.cjs and installs no `zcode` command itself.
  kind: "app",
  commands: [ZCODE_ID],
  appPaths: ["/Applications/ZCode.app"],
  configPaths: [{ agentHome: ZCODE_ID, path: zcodeDatabaseBelowHome }, ZCODE_CREDENTIAL_FILE],
  mcpConfigPaths: [],
  version: VERSION_FLAG,
  auth: {
    credentialFiles: [{ path: ZCODE_CREDENTIAL_FILE, parse: parseZcodeCredentials }]
  },
  warnings: [
    "The beta build's storage directory (~/.zcode-beta through ZCODE_BETA=1 or ZCODE_ENV=beta) is not followed; only ZCODE_STORAGE_DIR is.",
    "The credential file sits under ZCODE_DATA_BASE_DIR (default the home directory), not ZCODE_STORAGE_DIR; only ~/.zcode/v2/credentials.json is checked."
  ]
};
