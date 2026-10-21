import * as z from "zod/mini";

import { type AuthReading, type ProbeRecipe, VERSION_FLAG } from "@rivus/agent-kit-discovery/spi";
import { OPENCODE_ID, OPENCODE_AUTH_FILE, OPENCODE_AUTH_ENV } from "./facts.js";
import { opencodeDatabaseFile, opencodeMessageDirectory } from "./layout.js";

const Entries = z.record(z.string(), z.unknown());
const Entry = z.object({ type: z.enum(["oauth", "api", "wellknown"]) });

/**
 * Reads opencode's `auth.json`, which maps a provider to one stored credential; entries opencode would not load are
 * not counted. Only the count is used.
 */
function parseOpencodeAuthFile(json: unknown): AuthReading | undefined {
  const parsed = Entries.safeParse(json);
  if (!parsed.success) {
    return undefined;
  }
  return { loggedIn: Object.values(parsed.data).some((entry) => Entry.safeParse(entry).success) };
}

export const opencodeProbe: ProbeRecipe = {
  specificationVersion: "discovery-v1",
  agent: OPENCODE_ID,
  displayName: OPENCODE_ID,
  kind: "cli",
  commands: [OPENCODE_ID],
  appPaths: [],
  configPaths: [
    { agentHome: OPENCODE_ID, path: opencodeDatabaseFile },
    { agentHome: OPENCODE_ID, path: opencodeMessageDirectory },
    { agentHome: OPENCODE_ID, path: OPENCODE_AUTH_FILE }
  ],
  mcpConfigPaths: [],
  version: VERSION_FLAG,
  auth: {
    credentialFiles: [{ path: { agentHome: OPENCODE_ID, path: OPENCODE_AUTH_FILE }, parse: parseOpencodeAuthFile }],
    // Replaces auth.json when set.
    env: [{ name: OPENCODE_AUTH_ENV }]
  },
  warnings: []
};
