import {
  GROK_API_KEY_ENV,
  GROK_AUTH_FILE,
  GROK_DISPLAY_NAME,
  GROK_ID,
  GROK_SESSIONS_DIR,
  GROK_VERSION_SIDE_EFFECT
} from "./facts.js";
import * as z from "zod/mini";

import { type AuthReading, type ProbeRecipe, VERSION_FLAG } from "@rivus/agent-kit-discovery/spi";

const Entries = z.record(z.string(), z.unknown());

/** Reads Grok's `auth.json`, which maps a scope to one stored credential. Only the number of entries is used. */
export function parseGrokAuthFile(json: unknown): AuthReading | undefined {
  const parsed = Entries.safeParse(json);
  return parsed.success ? { loggedIn: Object.keys(parsed.data).length > 0 } : undefined;
}

export const grokProbe: ProbeRecipe = {
  specificationVersion: "discovery-v1",
  agent: GROK_ID,
  displayName: GROK_DISPLAY_NAME,
  kind: "cli",
  commands: [GROK_ID],
  appPaths: [],
  configPaths: [
    { agentHome: GROK_ID, path: GROK_SESSIONS_DIR },
    { agentHome: GROK_ID, path: GROK_AUTH_FILE }
  ],
  mcpConfigPaths: [],
  version: {
    ...VERSION_FLAG,
    sideEffects: [GROK_VERSION_SIDE_EFFECT]
  },
  auth: {
    credentialFiles: [{ path: { agentHome: GROK_ID, path: GROK_AUTH_FILE }, parse: parseGrokAuthFile }],
    // Used when no login is stored.
    env: [{ name: GROK_API_KEY_ENV, method: "api-key" }]
  },
  warnings: []
};
