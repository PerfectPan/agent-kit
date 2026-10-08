import type { AcpProfile } from "../domain/acp-session/index.js";
import { BASE_ENV } from "./base-env.js";

/** `grok agent stdio`, Grok's ACP server over stdio; `grok agent --help` lists it. */
export const grokAcpProfile: AcpProfile = {
  specificationVersion: "acp-v1",
  agent: "grok",
  command: "grok",
  args: ["agent", "stdio"],
  env: [...BASE_ENV, "GROK_*", "XAI_*"],
  systemPrompt: { in: "meta", key: "rules" },
  warnings: [
    "unverified: _meta.rules appends to Grok's system prompt like the --rules flag; it does not replace the prompt"
  ]
};
