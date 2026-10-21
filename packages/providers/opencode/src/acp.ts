import { type AcpProfile, BASE_ENV } from "@rivus/agent-kit-acp/spi";
import { OPENCODE_ID, OPENCODE_ACP_ARGS, OPENCODE_ACP_ENV } from "./facts.js";

/**
 * `opencode acp`. Version 1.18.30 has no system prompt channel. opencode reaches many model providers, so every
 * `*_API_KEY` variable passes, with opencode's own and the common provider settings.
 */
export const opencodeAcpProfile: AcpProfile = {
  specificationVersion: "acp-v1",
  agent: OPENCODE_ID,
  command: OPENCODE_ID,
  args: OPENCODE_ACP_ARGS,
  env: [...BASE_ENV, ...OPENCODE_ACP_ENV],
  systemPrompt: { in: "first-block" },
  warnings: []
};
