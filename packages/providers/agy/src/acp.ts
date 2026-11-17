import { type AcpProfile, BASE_ENV } from "@rivus/agent-kit-acp/spi";
import { AGY_ACP_ARGS, AGY_ACP_ENV, AGY_COMMAND, AGY_ID } from "./facts.js";

/**
 * `agy acp` (verified against 1.5.10: the subcommand starts the Agent Client Protocol stdio JSON-RPC server, and
 * takes `--add-dir`, `--agent`, `--sandbox`, `--login` and `--dangerously-skip-permissions`). Permission requests
 * reach the client over the protocol, so the profile launches the server without the auto-approve flag; hosts
 * answer them through `onPermission`.
 */
export const agyAcpProfile: AcpProfile = {
  specificationVersion: "acp-v1",
  agent: AGY_ID,
  command: AGY_COMMAND,
  args: AGY_ACP_ARGS,
  env: [...BASE_ENV, ...AGY_ACP_ENV],
  systemPrompt: { in: "first-block" },
  warnings: [
    "unverified: whether session/new reads a system prompt from _meta; the profile opens the first prompt with it",
    "unverified: newer releases may rename the acp subcommand, as Gemini CLI's --experimental-acp shows"
  ]
};
