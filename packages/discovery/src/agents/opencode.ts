import * as z from "zod/mini";

import type { AuthReading, ProbeRecipe } from "../domain/installation/index.js";
import { VERSION_FLAG } from "./version-flag.js";

const Entries = z.record(z.string(), z.unknown());
const Entry = z.object({ type: z.enum(["oauth", "api", "wellknown"]) });

/**
 * Reads opencode's `auth.json`, which maps a provider to one stored credential; entries opencode would not load are
 * not counted. Only the count is used.
 */
export function parseOpencodeAuthFile(json: unknown): AuthReading | undefined {
  const parsed = Entries.safeParse(json);
  if (!parsed.success) {
    return undefined;
  }
  return { loggedIn: Object.values(parsed.data).some((entry) => Entry.safeParse(entry).success) };
}

export const opencodeProbe: ProbeRecipe = {
  specificationVersion: "discovery-v1",
  agent: "opencode",
  displayName: "opencode",
  kind: "cli",
  commands: ["opencode"],
  appPaths: [],
  configPaths: ["~/.config/opencode"],
  mcpConfigPaths: ["~/.config/opencode/opencode.json", "~/.config/opencode/opencode.jsonc"],
  version: VERSION_FLAG,
  auth: {
    credentialFiles: [{ path: { agentHome: "opencode", path: "auth.json" }, parse: parseOpencodeAuthFile }],
    // Replaces auth.json when set.
    env: [{ name: "OPENCODE_AUTH_CONTENT" }]
  },
  warnings: []
};
