import { GROK_ACP_ARGS, GROK_ACP_ENV, GROK_ID } from "./facts.js";
import { type AcpProfile, BASE_ENV } from "@rivus/agent-kit-acp/spi";

/** `grok agent stdio`, Grok's ACP server over stdio; `grok agent --help` lists it. */
export const grokAcpProfile: AcpProfile = {
  specificationVersion: "acp-v1",
  agent: GROK_ID,
  command: GROK_ID,
  args: GROK_ACP_ARGS,
  env: [...BASE_ENV, ...GROK_ACP_ENV],
  systemPrompt: { in: "meta", key: "rules" },
  warnings: [
    "unverified: _meta.rules appends to Grok's system prompt like the --rules flag; it does not replace the prompt"
  ]
};
