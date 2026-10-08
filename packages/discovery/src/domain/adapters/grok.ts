import * as z from "zod/mini";

import type { AuthReading, ProbeRecipe } from "../installation/index.js";
import { VERSION_FLAG } from "./version-flag.js";

const Entries = z.record(z.string(), z.unknown());

/** Reads Grok's `auth.json`, which maps a scope to one stored credential. Only the number of entries is used. */
export function parseGrokAuthFile(json: unknown): AuthReading | undefined {
  const parsed = Entries.safeParse(json);
  return parsed.success ? { loggedIn: Object.keys(parsed.data).length > 0 } : undefined;
}

export const grokProbe: ProbeRecipe = {
  specificationVersion: "discovery-v1",
  agent: "grok",
  displayName: "Grok",
  kind: "cli",
  commands: ["grok"],
  appPaths: [],
  configPaths: [{ agentHome: "grok" }],
  mcpConfigPaths: [],
  version: {
    ...VERSION_FLAG,
    sideEffects: ["Creates ~/.grok, or $GROK_HOME, when it does not exist, as every grok run does."]
  },
  auth: {
    credentialFiles: [{ path: { agentHome: "grok", path: "auth.json" }, parse: parseGrokAuthFile }],
    // Used when no login is stored.
    env: [{ name: "XAI_API_KEY", method: "api-key" }]
  },
  warnings: []
};
