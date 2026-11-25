import { type AcpProfile, BASE_ENV } from "@rivus/agent-kit-acp/spi";
import { COPILOT_ACP_ARGS, COPILOT_ACP_ENV, COPILOT_COMMAND, COPILOT_ID } from "./facts.js";

/**
 * `copilot --acp` (verified against GitHub Copilot CLI 1.0.114: starts the Agent Client Protocol stdio JSON-RPC
 * server). Permission requests reach the client over the protocol, so the profile launches the server without
 * auto-approve flags; hosts answer them through `onPermission`.
 */
export const copilotAcpProfile: AcpProfile = {
  specificationVersion: "acp-v1",
  agent: COPILOT_ID,
  command: COPILOT_COMMAND,
  args: COPILOT_ACP_ARGS,
  env: [...BASE_ENV, ...COPILOT_ACP_ENV],
  systemPrompt: { in: "first-block" },
  warnings: [
    "unverified: whether session/new reads a system prompt from _meta; the profile opens the first prompt with it"
  ]
};
